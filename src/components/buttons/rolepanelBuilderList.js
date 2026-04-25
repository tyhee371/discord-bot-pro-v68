const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

module.exports = {
  id: 'rolepanelBuilderList',
  async execute(interaction) {
    const [, action] = interaction.customId.split(':'); // rolepanelBuilderList:preview|edit|remove
    const act = action || 'preview';

    const modal = new ModalBuilder()
      .setCustomId(`rolepanelBuilderList:${act}`)
      .setTitle(
        act === 'remove' ? 'Remove Role Panel Builder'
        : act === 'edit' ? 'Edit Role Panel Builder'
        : 'Preview Role Panel Builder'
      );

    const builderId = new TextInputBuilder()
      .setCustomId('builder_id')
      .setLabel('Builder ID')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('e.g. panel (from /rolepanel builder-list)');

    modal.addComponents(new ActionRowBuilder().addComponents(builderId));
    return interaction.showModal(modal);
  },
};
