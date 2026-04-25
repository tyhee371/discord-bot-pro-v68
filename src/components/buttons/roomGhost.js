const { MessageFlags } = require('discord.js');
const { requireRoom, canManage } = require('../../utils/roomAuth');
const { setRoom } = require('../../services/tempRoomService');
const { refreshRoomPanel } = require('../../utils/roomPanelService');

module.exports = {
  id: 'room:ghost',
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const res = await requireRoom(interaction);
    if (!res.ok) return interaction.editReply(res.reason);

    const { room, voiceChannel } = res;
    if (!canManage(interaction, room)) return interaction.editReply('Only the room owner (or staff) can do that.');

    room.isHidden = !room.isHidden;

    const everyoneId = interaction.guild.roles.everyone.id;

    await voiceChannel.permissionOverwrites.edit(everyoneId, {
      ViewChannel: room.isHidden ? false : true,
      Connect: room.isLocked ? false : true,
    }).catch(() => {});

    await setRoom(interaction.guildId, voiceChannel.id, room);
    await refreshRoomPanel(interaction.guild, voiceChannel, room);

    return interaction.editReply(room.isHidden ? '👻 Room hidden (ghost).' : '👁️ Room visible.');
  },
};
