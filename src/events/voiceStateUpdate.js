const {
  Events,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const { getGuildSettings } = require('../utils/settings');
const { defaultRoomData, getRoom, setRoom, deleteRoom } = require('../services/tempRoomService');
const { buildRoomEmbed, buildRoomButtons } = require('../utils/roomPanel');

// Instant delete when empty (no delay).
async function maybeDeleteEmptyRoom(oldChannel, guildId) {
  const room = await getRoom(guildId, oldChannel.id);
  if (!room) return;

  if (oldChannel.members?.size > 0) return;

  const latest = await oldChannel.guild.channels.fetch(oldChannel.id).catch(() => null);
  if (!latest) {
    await deleteRoom(guildId, oldChannel.id);
    return;
  }
  if (latest.members.size > 0) return;

  // delete paired text if any
  const r = await getRoom(guildId, oldChannel.id);
  if (r?.textChannelId) {
    const txt = await oldChannel.guild.channels.fetch(r.textChannelId).catch(() => null);
    if (txt) await txt.delete('Temp room cleanup').catch(() => {});
  }

  await latest.delete('Temp room empty cleanup').catch(() => {});
  await deleteRoom(guildId, oldChannel.id);
}

function chunkOverwrites(ch) {
  return ch.permissionOverwrites.cache.map((o) => ({
    id: o.id,
    allow: o.allow.bitfield,
    deny: o.deny.bitfield,
    type: o.type,
  }));
}

async function ensurePairedTextChannel(guild, voiceChannel, room) {
  if (room.textChannelId) {
    const existing = await guild.channels.fetch(room.textChannelId).catch(() => null);
    if (existing) return existing;
  }

  const textChannel = await guild.channels.create({
    name: `room-${voiceChannel.name}`.slice(0, 90),
    type: ChannelType.GuildText,
    parent: voiceChannel.parentId ?? null,
    permissionOverwrites: chunkOverwrites(voiceChannel),
    topic: `Room controls | roomVoiceId=${voiceChannel.id}`,
    reason: 'Create paired text channel for room controls',
  });

  room.textChannelId = textChannel.id;
  await setRoom(guild.id, voiceChannel.id, room);
  return textChannel;
}

/**
 * Send or edit a message either in the Text-in-Voice chat (preferred) or in the paired text channel.
 * Returns { messageId, channelId }.
 */
async function sendOrEditRoomMessage(guild, voiceChannel, room, state, payload) {
  const messageId = state?.messageId ?? null;
  const channelId = state?.channelId ?? null;

  // If we know exactly where the message is, edit it there first.
  if (messageId && channelId) {
    const ch = await guild.channels.fetch(channelId).catch(() => null);
    if (ch && ch.isTextBased?.()) {
      const msg = await ch.messages.fetch(messageId).catch(() => null);
      if (msg) {
        await msg.edit(payload).catch(() => {});
        return { messageId: msg.id, channelId: ch.id };
      }
    }
  }

  // Try Text-in-Voice chat.
  try {
    const msg = await voiceChannel.send(payload);
    return { messageId: msg.id, channelId: voiceChannel.id };
  } catch {
    // Fallback to paired text channel.
    const txt = await ensurePairedTextChannel(guild, voiceChannel, room).catch(() => null);
    if (!txt) return { messageId: null, channelId: null };

    const msg = await txt.send(payload).catch(() => null);
    return { messageId: msg?.id ?? null, channelId: txt.id };
  }
}

async function postOrUpdateControlPanel(guild, voiceChannel, room) {
  const embed = buildRoomEmbed({ channel: voiceChannel, room });
  const rows = buildRoomButtons();

  const res = await sendOrEditRoomMessage(
    guild,
    voiceChannel,
    room,
    { messageId: room.controlMessageId, channelId: room.controlChannelId },
    { embeds: [embed], components: rows },
  );

  room.controlMessageId = res.messageId ?? room.controlMessageId ?? null;
  room.controlChannelId = res.channelId ?? room.controlChannelId ?? null;
  await setRoom(guild.id, voiceChannel.id, room);
}

function buildOwnerDisconnectedEmbed({ voiceChannel, ownerId }) {
  const embed = new EmbedBuilder()
    .setTitle('Room owner disconnected')
    .setDescription(
      [
        `Owner: <@${ownerId}>`,
        `Room: <#${voiceChannel.id}>`,
        '',
        'The owner left the room while other members are still inside.',
        'If the owner does not come back, someone can claim ownership.',
      ].join('\n'),
    )
    .setFooter({ text: 'Temp Rooms • Claim ownership' })
    .setTimestamp();

  return embed;
}

function buildOwnerReconnectedEmbed({ voiceChannel, ownerId }) {
  return new EmbedBuilder()
    .setTitle('Room owner reconnected')
    .setDescription(
      [
        `Owner: <@${ownerId}>`,
        `Room: <#${voiceChannel.id}>`,
        '',
        'Owner is back in the room. Claim is not available right now.',
      ].join('\n'),
    )
    .setTimestamp();
}

function buildClaimRow(voiceId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`room:claim:${voiceId}`)
        .setLabel('Claim ownership')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

async function handleOwnerLeftButRoomNotEmpty(guild, voiceChannel, room) {
  const embed = buildOwnerDisconnectedEmbed({ voiceChannel, ownerId: room.ownerId });
  const rows = buildClaimRow(voiceChannel.id);

  const res = await sendOrEditRoomMessage(
    guild,
    voiceChannel,
    room,
    { messageId: room.ownerClaimMessageId, channelId: room.ownerClaimChannelId },
    { embeds: [embed], components: rows, allowedMentions: { users: [room.ownerId] } },
  );

  room.ownerClaimMessageId = res.messageId ?? room.ownerClaimMessageId ?? null;
  room.ownerClaimChannelId = res.channelId ?? room.ownerClaimChannelId ?? null;
  room.ownerDisconnectedAt = Date.now();
  await setRoom(guild.id, voiceChannel.id, room);
}

async function handleOwnerReconnected(guild, voiceChannel, room) {
  if (!room.ownerClaimMessageId || !room.ownerClaimChannelId) return;

  const embed = buildOwnerReconnectedEmbed({ voiceChannel, ownerId: room.ownerId });
  const rows = buildClaimRow(voiceChannel.id);

  const res = await sendOrEditRoomMessage(
    guild,
    voiceChannel,
    room,
    { messageId: room.ownerClaimMessageId, channelId: room.ownerClaimChannelId },
    { embeds: [embed], components: rows, allowedMentions: { users: [room.ownerId] } },
  );

  room.ownerClaimMessageId = res.messageId ?? room.ownerClaimMessageId ?? null;
  room.ownerClaimChannelId = res.channelId ?? room.ownerClaimChannelId ?? null;
  room.ownerDisconnectedAt = null;
  await setRoom(guild.id, voiceChannel.id, room);
}

async function createRoomFor(member, settings) {
  const guild = member.guild;
  const roomsCfg = settings.rooms;
  if (!roomsCfg?.masterChannelId || !roomsCfg?.categoryId) return null;

  const category = await guild.channels.fetch(roomsCfg.categoryId);
  const baseName = roomsCfg.nameTemplate
    ? roomsCfg.nameTemplate.replace('{user}', member.user.username)
    : `${member.user.username}'s room`;

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
    },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.MoveMembers,
        PermissionFlagsBits.MuteMembers,
        PermissionFlagsBits.DeafenMembers,
      ],
    },
  ];

  const voiceChannel = await guild.channels.create({
    name: baseName.slice(0, 90),
    type: ChannelType.GuildVoice,
    parent: category.id,
    bitrate: roomsCfg.defaultBitrate ?? undefined,
    userLimit: roomsCfg.defaultUserLimit ?? 0,
    rtcRegion: roomsCfg.defaultRegion ?? null,
    permissionOverwrites: overwrites,
    reason: `Temp room created for ${member.user.tag}`,
  });

  await member.voice.setChannel(voiceChannel).catch(() => {});

  const room = defaultRoomData({
    guildId: guild.id,
    channelId: voiceChannel.id,
    ownerId: member.id,
  });

  room.rtcRegion = voiceChannel.rtcRegion ?? null;
  room.userLimit = voiceChannel.userLimit ?? 0;
  room.bitrate = voiceChannel.bitrate ?? null;

  room.ownerClaimMessageId = null;
  room.ownerClaimChannelId = null;
  room.ownerDisconnectedAt = null;

  room.controlMessageId = null;
  room.controlChannelId = null;

  await setRoom(guild.id, voiceChannel.id, room);
  await postOrUpdateControlPanel(guild, voiceChannel, room).catch(() => {});
  return room;
}

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(client, oldState, newState) {
    const guild = newState.guild ?? oldState.guild;
    if (!guild) return;

    const settings = await getGuildSettings(guild.id);
    const masterId = settings.rooms?.masterChannelId;

    const oldChannel = oldState.channel;
    const newChannel = newState.channel;

    // Joined master -> create room (ALLOW MULTIPLE ROOMS PER USER)
    if (newChannel && masterId && newChannel.id === masterId) {
      await createRoomFor(newState.member, settings).catch(console.error);
    }

    // Owner left a temp room while others remain -> show claim panel
    if (oldChannel && oldChannel.id !== masterId) {
      const room = await getRoom(guild.id, oldChannel.id);
      if (room) {
        const leavingId = oldState.member?.id;
        const isOwnerLeaving = leavingId && room.ownerId === leavingId;

        if (isOwnerLeaving && (!newChannel || newChannel.id !== oldChannel.id) && oldChannel.members.size > 0) {
          await handleOwnerLeftButRoomNotEmpty(guild, oldChannel, room).catch(() => {});
        }
      }

      await maybeDeleteEmptyRoom(oldChannel, guild.id).catch(console.error);
    }

    // Owner reconnected to their room -> update claim message
    if (newChannel && newChannel.id !== masterId) {
      const room = await getRoom(guild.id, newChannel.id);
      if (room && newState.member?.id === room.ownerId) {
        await handleOwnerReconnected(guild, newChannel, room).catch(() => {});
      }
    }
  },
};
