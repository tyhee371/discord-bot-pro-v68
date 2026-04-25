const {
  MessageFlags,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { requireRoom, canManage } = require('../../utils/roomAuth');

module.exports = {
  id: 'room:edit',
  async execute(interaction) {
    const res = await requireRoom(interaction);
    if (!res.ok) {
      return interaction.reply({ content: res.reason, flags: MessageFlags.Ephemeral });
    }
    const { room, voiceChannel } = res;
    if (!canManage(interaction, room)) {
      return interaction.reply({ content: 'Only the room owner (or staff) can do that.', flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
      .setCustomId(`roomEdit:${voiceChannel.id}`)
      .setTitle('Edit Room');

    const name = new TextInputBuilder()
      .setCustomId('name')
      .setLabel('Name (leave blank to keep)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    const bitrate = new TextInputBuilder()
      .setCustomId('bitrate')
      .setLabel('Bitrate (bps) e.g. 64000 (blank=keep)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    const limit = new TextInputBuilder()
      .setCustomId('limit')
      .setLabel('User limit (0=unlimited, blank=keep)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(name),
      new ActionRowBuilder().addComponents(bitrate),
      new ActionRowBuilder().addComponents(limit),
    );

    await interaction.showModal(modal);
  },
};
