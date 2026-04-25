const {
  MessageFlags,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { requireRoom, canManage } = require('../../utils/roomAuth');

module.exports = {
  id: 'room:transfer',
  async execute(interaction) {
    const res = await requireRoom(interaction);
    if (!res.ok) return interaction.reply({ content: res.reason, flags: MessageFlags.Ephemeral });

    const { room, voiceChannel } = res;
    if (!canManage(interaction, room)) {
      return interaction.reply({ content: 'Only the room owner (or staff) can do that.', flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
      .setCustomId(`roomUserAction:transfer:${voiceChannel.id}`)
      .setTitle('Change room owner');

    const user = new TextInputBuilder()
      .setCustomId('user')
      .setLabel('New owner mention or ID')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(user));
    await interaction.showModal(modal);
  },
};
