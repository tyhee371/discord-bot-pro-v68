const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { getRoom, setRoom } = require('../../services/tempRoomService');
const { refreshRoomPanel } = require('../../utils/roomPanelService');

function parseIntOrNull(v) {
  const s = (v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

module.exports = {
  id: 'roomEdit',
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const voiceId = interaction.customId.split(':')[1];
    const room = await getRoom(interaction.guildId, voiceId);
    if (!room) return interaction.editReply('Room not found (maybe expired).');

    const voiceChannel = await interaction.guild.channels.fetch(voiceId).catch(() => null);
    if (!voiceChannel) return interaction.editReply('Room channel no longer exists.');

    // Permission check
    const canManage =
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || interaction.user.id === room.ownerId;
    if (!canManage) return interaction.editReply('Only the room owner (or staff) can do that.');

    const name = interaction.fields.getTextInputValue('name')?.trim();
    const bitrate = parseIntOrNull(interaction.fields.getTextInputValue('bitrate'));
    const limit = parseIntOrNull(interaction.fields.getTextInputValue('limit'));

    const updates = [];

    if (name) updates.push(voiceChannel.setName(name.slice(0, 90), `Room edit by ${interaction.user.tag}`));
    if (bitrate !== null) updates.push(voiceChannel.setBitrate(bitrate, `Room edit by ${interaction.user.tag}`));
    if (limit !== null) updates.push(voiceChannel.setUserLimit(limit, `Room edit by ${interaction.user.tag}`));

    try {
      await Promise.all(updates);
    } catch (e) {
      return interaction.editReply(`Failed to update room settings: ${e.message ?? e}`);
    }

    // update stored info
    room.bitrate = voiceChannel.bitrate ?? room.bitrate;
    room.userLimit = voiceChannel.userLimit ?? room.userLimit;
    await setRoom(interaction.guildId, voiceId, room);

    await refreshRoomPanel(interaction.guild, voiceChannel, room);
    return interaction.editReply('✅ Room updated.');
  },
};
