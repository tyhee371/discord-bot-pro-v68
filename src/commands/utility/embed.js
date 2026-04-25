const {
  SlashCommandBuilder,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

module.exports = {
  usesModal: true,
  defer: false,

  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Create an embed via a modal (supports image, thumbnail, footer + timestamp).'),

  async execute(interaction) {
    const modal = new ModalBuilder()
      .setCustomId(`embedBuilder:${interaction.channelId}`)
      .setTitle('Embed Builder');

    const title = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Title (optional)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    const description = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Description (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    const color = new TextInputBuilder()
      .setCustomId('color')
      .setLabel('Color hex or decimal (optional)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('#5865F2');

    // Keep within 5 rows by combining media fields into one input
    const media = new TextInputBuilder()
      .setCustomId('media')
      .setLabel('Media URLs (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setPlaceholder('thumbnail=https://...\nimage=https://...');

    const footer = new TextInputBuilder()
      .setCustomId('footer')
      .setLabel('Footer (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setPlaceholder('text=Your footer\ntimestamp=on');

    modal.addComponents(
      new ActionRowBuilder().addComponents(title),
      new ActionRowBuilder().addComponents(description),
      new ActionRowBuilder().addComponents(color),
      new ActionRowBuilder().addComponents(media),
      new ActionRowBuilder().addComponents(footer),
    );

    await interaction.showModal(modal);
  },
};
