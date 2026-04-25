const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { getRoom } = require('../services/tempRoomService');

function isStaff(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
}

async function requireRoom(interaction) {
  const ch = interaction.channel;
  const guild = interaction.guild;

  let voiceId = null;

  // If interaction is happening in the voice channel's own chat
  if (ch && ch.type === ChannelType.GuildVoice) {
    voiceId = ch.id;
  }

  // If it's in a paired text channel, we store voiceId in the topic
  if (!voiceId && ch?.topic) {
    const m = ch.topic.match(/roomVoiceId=(\d{17,20})/);
    if (m) voiceId = m[1];
  }

  if (!voiceId) return { ok: false, reason: 'Room not found for this channel.' };

  const room = await getRoom(guild.id, voiceId);
  if (!room) return { ok: false, reason: 'This is not a managed room (or it expired).' };

  const voiceChannel = await guild.channels.fetch(voiceId).catch(() => null);
  if (!voiceChannel) return { ok: false, reason: 'Room channel no longer exists.' };

  return { ok: true, room, voiceChannel };
}

function canManage(interaction, room) {
  return isStaff(interaction) || interaction.user.id === room.ownerId;
}

module.exports = { requireRoom, canManage, isStaff };
