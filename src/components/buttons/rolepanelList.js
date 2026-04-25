const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

module.exports = {
  id: 'rolepanelList',
  async execute(interaction) {
    const [, action] = interaction.customId.split(':'); // rolepanelList:edit|remove
    const act = action || 'edit';

    const modal = new ModalBuilder()
      .setCustomId(`rolepanelList:${act}`)
      .setTitle(act === 'remove' ? 'Remove Role Option' : 'Edit Role Option');

    const builderId = new TextInputBuilder()
      .setCustomId('builder_id')
      .setLabel('Builder ID')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('Builder id from /rolepanel builder-list');

    const index = new TextInputBuilder()
      .setCustomId('index')
      .setLabel('Option number (from /rolepanel list)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('e.g. 1');

    modal.addComponents(
      new ActionRowBuilder().addComponents(builderId),
      new ActionRowBuilder().addComponents(index),
    );

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

      modal.addComponents(
        new ActionRowBuilder().addComponents(label),
        new ActionRowBuilder().addComponents(description),
      );
    }

    return interaction.showModal(modal);
  },
};
