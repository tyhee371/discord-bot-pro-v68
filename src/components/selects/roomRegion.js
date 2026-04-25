const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { getRoom, setRoom } = require('../../services/tempRoomService');
const { refreshRoomPanel } = require('../../utils/roomPanelService');

module.exports = {
  id: 'roomRegion',
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const voiceId = interaction.customId.split(':')[1];
    const room = await getRoom(interaction.guildId, voiceId);
    if (!room) return interaction.editReply('Room not found (maybe expired).');

    const voiceChannel = await interaction.guild.channels.fetch(voiceId).catch(() => null);
    if (!voiceChannel) return interaction.editReply('Room channel no longer exists.');

    const canManage =
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || interaction.user.id === room.ownerId;
    if (!canManage) return interaction.editReply('Only the room owner (or staff) can do that.');

    const value = interaction.values?.[0];
    const region = value === 'auto' ? null : value;

    try {
      await voiceChannel.setRTCRegion(region, `Room region change by ${interaction.user.tag}`);
    } catch (e) {
      return interaction.editReply(`Failed to change region: ${e.message ?? e}`);
    }

    room.rtcRegion = voiceChannel.rtcRegion ?? null;
    await setRoom(interaction.guildId, voiceId, room);
    await refreshRoomPanel(interaction.guild, voiceChannel, room);

    return interaction.editReply(`✅ Region updated to **${region ?? 'auto'}**.`);
  },
};
