const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { parseUserId } = require('../../utils/parseUser');
const { getRoom, setRoom } = require('../../services/tempRoomService');
const { refreshRoomPanel } = require('../../utils/roomPanelService');

async function disconnectIfInChannel(guild, userId, channelId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (member?.voice?.channelId === channelId) {
    await member.voice.setChannel(null).catch(() => {});
  }
}

module.exports = {
  id: 'roomUserAction',
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [, action, voiceId] = interaction.customId.split(':');
    const room = await getRoom(interaction.guildId, voiceId);
    if (!room) return interaction.editReply('Room not found (maybe expired).');

    const voiceChannel = await interaction.guild.channels.fetch(voiceId).catch(() => null);
    if (!voiceChannel) return interaction.editReply('Room channel no longer exists.');

    const canManage =
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || interaction.user.id === room.ownerId;
    if (!canManage) return interaction.editReply('Only the room owner (or staff) can do that.');

    const raw = interaction.fields.getTextInputValue('user');
    const userId = parseUserId(raw);
    if (!userId) return interaction.editReply('Invalid user. Provide a mention like `<@123>` or an ID.');

    if (action === 'kick') {
      await disconnectIfInChannel(interaction.guild, userId, voiceId);
      return interaction.editReply(`👢 Kicked <@${userId}> from the room (disconnected).`);
    }

    if (action === 'ban') {
      if (!room.banned.includes(userId)) room.banned.push(userId);

      await voiceChannel.permissionOverwrites.edit(userId, {
        ViewChannel: false,
        Connect: false,
      }).catch(() => {});

      await disconnectIfInChannel(interaction.guild, userId, voiceId);

      await setRoom(interaction.guildId, voiceId, room);
      await refreshRoomPanel(interaction.guild, voiceChannel, room);

      return interaction.editReply(`⛔ Banned <@${userId}> from the room.`);
    }

    if (action === 'permit') {
      room.banned = room.banned.filter(id => id !== userId);
      if (!room.permitted.includes(userId)) room.permitted.push(userId);

      await voiceChannel.permissionOverwrites.edit(userId, {
        ViewChannel: true,
        Connect: true,
        Speak: true,
      }).catch(() => {});

      await setRoom(interaction.guildId, voiceId, room);
      await refreshRoomPanel(interaction.guild, voiceChannel, room);

      return interaction.editReply(`✅ Permitted <@${userId}> to join/see the room.`);
    }

    if (action === 'transfer') {
      const oldOwner = room.ownerId;
      room.ownerId = userId;

      // Ensure new owner can manage
      await voiceChannel.permissionOverwrites.edit(userId, {
        ViewChannel: true,
        Connect: true,
        Speak: true,
        ManageChannels: true,
        MoveMembers: true,
        MuteMembers: true,
        DeafenMembers: true,
      }).catch(() => {});

      // Optional: reduce old owner's manage perms (keep access)
      await voiceChannel.permissionOverwrites.edit(oldOwner, {
        ManageChannels: false,
        MoveMembers: false,
        MuteMembers: false,
        DeafenMembers: false,
      }).catch(() => {});

      await setRoom(interaction.guildId, voiceId, room);
      await refreshRoomPanel(interaction.guild, voiceChannel, room);

      return interaction.editReply(`👑 Transferred ownership to <@${userId}>.`);
    }

    return interaction.editReply('Unknown action.');
  },
};
