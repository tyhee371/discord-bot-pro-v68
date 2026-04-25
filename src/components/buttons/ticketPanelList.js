const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

module.exports = {
  id: 'ticketPanelList',
  async execute(interaction) {
    const [, action] = interaction.customId.split(':'); // ticketPanelList:edit|remove
    const act = action || 'edit';

    const modal = new ModalBuilder()
      .setCustomId(`ticketPanelList:${act}`)
      .setTitle(act === 'remove' ? 'Remove Ticket Option' : 'Edit Ticket Option');

    const builderId = new TextInputBuilder()
      .setCustomId('builder_id')
      .setLabel('Builder ID')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('Builder id shown in /ticket builder-list');

    const index = new TextInputBuilder()
      .setCustomId('index')
      .setLabel('Option index (number from panel-list)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('e.g. 1');

    modal.addComponents(new ActionRowBuilder().addComponents(builderId));
    modal.addComponents(new ActionRowBuilder().addComponents(index));

    if (act === 'edit') {
      const label = new TextInputBuilder()
        .setCustomId('label')
        .setLabel('New label (leave blank to keep)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      const description = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('New description (leave blank to keep)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

      const value = new TextInputBuilder()
        .setCustomId('value')
        .setLabel('New value/id (leave blank to keep)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      modal.addComponents(new ActionRowBuilder().addComponents(label));
      modal.addComponents(new ActionRowBuilder().addComponents(description));
      modal.addComponents(new ActionRowBuilder().addComponents(value));
    }

    return interaction.showModal(modal);
  },
};
