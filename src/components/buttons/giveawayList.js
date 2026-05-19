/**
 * Button handler for /giveaway list actions.
 * customId: giveawayList:end | giveawayList:edit | giveawayList:delete | giveawayList:entries
 */
const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');

module.exports = {
  id: 'giveawayList',
  async execute(interaction) {
    const [, action] = interaction.customId.split(':');

    const modal = new ModalBuilder()
      .setCustomId(`giveawayList_modal:${action}`)
      .setTitle(
        action === 'end'     ? '⏹ End Giveaway (Emergency)' :
        action === 'edit'    ? '✏️ Edit Giveaway' :
        action === 'delete'  ? '🗑️ Delete Giveaway' :
        action === 'entries' ? '👥 View Giveaway Entries' :
        'Giveaway Action'
      );

    const messageId = new TextInputBuilder()
      .setCustomId('message_id')
      .setLabel('Giveaway Message ID')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('The ID shown in /giveaway list (e.g. 1234567890)');

    modal.addComponents(new ActionRowBuilder().addComponents(messageId));

    // Edit needs extra fields
    if (action === 'edit') {
      const prize = new TextInputBuilder()
        .setCustomId('prize')
        .setLabel('New Prize (leave blank to keep)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(100);

      const description = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('New Description (leave blank to keep)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(500);

      const winners = new TextInputBuilder()
        .setCustomId('winners')
        .setLabel('New Winner Count (leave blank to keep)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(2);

      modal.addComponents(
        new ActionRowBuilder().addComponents(prize),
        new ActionRowBuilder().addComponents(description),
        new ActionRowBuilder().addComponents(winners),
      );
    }

    return interaction.showModal(modal);
  },
};
