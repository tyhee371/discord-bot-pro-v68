const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { requireRoom, canManage } = require('../../utils/roomAuth');
const { setRoom } = require('../../services/tempRoomService');
const { refreshRoomPanel } = require('../../utils/roomPanelService');

module.exports = {
  id: 'room:lock',
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const res = await requireRoom(interaction);
    if (!res.ok) return interaction.editReply(res.reason);

    const { room, voiceChannel } = res;
    if (!canManage(interaction, room)) return interaction.editReply('Only the room owner (or staff) can do that.');

    room.isLocked = !room.isLocked;

    // Lock = deny CONNECT for @everyone
    const everyoneId = interaction.guild.roles.everyone.id;

    await voiceChannel.permissionOverwrites.edit(everyoneId, {
      Connect: room.isLocked ? false : null,
      ViewChannel: room.isHidden ? false : true,
    }).catch(() => {});

    await setRoom(interaction.guildId, voiceChannel.id, room);
    await refreshRoomPanel(interaction.guild, voiceChannel, room);

    return interaction.editReply(room.isLocked ? '🔒 Room locked (private).' : '🔓 Room unlocked (public).');
  },
};
