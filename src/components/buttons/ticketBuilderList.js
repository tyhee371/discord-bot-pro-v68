const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

module.exports = {
  id: 'ticketBuilderList',
  async execute(interaction) {
    const [, action] = interaction.customId.split(':'); // ticketBuilderList:preview|edit|remove
    const act = action || 'preview';

    const modal = new ModalBuilder()
      .setCustomId(`ticketBuilderList:${act}`)
      .setTitle(act === 'remove' ? 'Remove Ticket Builder' : act === 'edit' ? 'Edit Ticket Builder' : 'Preview Ticket Builder');

    const builderId = new TextInputBuilder()
      .setCustomId('builder_id')
      .setLabel('Builder ID')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('e.g. support');

    modal.addComponents(new ActionRowBuilder().addComponents(builderId));
    return interaction.showModal(modal);
  },
};
