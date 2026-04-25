const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const { getGuildSettings } = require('../../utils/settings');

function getBuilders(settings) {
  const b = settings?.rolePanel?.builders;
  return (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
}

module.exports = {
  id: 'rolepanelPanel',
  async execute(interaction) {
    if (!interaction.customId.startsWith('rolepanelPanel:edit')) return;

    const parts = interaction.customId.split(':'); // rolepanelPanel:edit:<builderId>
    const builderId = parts[2] || 'default';

    const settings = await getGuildSettings(interaction.guildId);
    const builders = getBuilders(settings);
    const builder = builders[builderId];
    const embed = builder?.embed ?? {};

    const modal = new ModalBuilder()
      .setCustomId(`rolepanelPanelBuilder:${builderId}:${interaction.channelId}:${interaction.message.id}`)
      .setTitle('Role Panel Embed');

    const title = new TextInputBuilder()
      .setCustomId('title').setLabel('Title (optional)').setStyle(TextInputStyle.Short).setRequired(false)
      .setValue((embed.title ?? builder?.name ?? '').slice(0, 256));

    const description = new TextInputBuilder()
      .setCustomId('description').setLabel('Description (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false)
      .setValue((embed.description ?? '').slice(0, 4000));

    const color = new TextInputBuilder()
      .setCustomId('color').setLabel('Color hex (optional)').setStyle(TextInputStyle.Short).setRequired(false)
      .setValue(embed.color != null ? String(embed.color) : '').setPlaceholder('#5865F2');

    const media = new TextInputBuilder()
      .setCustomId('media').setLabel('Media URLs (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false)
      .setValue([
        embed.thumbnailUrl ? `thumbnail=${embed.thumbnailUrl}` : '',
        embed.imageUrl ? `image=${embed.imageUrl}` : '',
      ].filter(Boolean).join('\n'))
      .setPlaceholder('thumbnail=https://...\nimage=https://...');

    const footer = new TextInputBuilder()
      .setCustomId('footer').setLabel('Footer (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false)
      .setValue([
        embed.footerText ? `text=${embed.footerText}` : '',
        embed.timestamp ? 'timestamp=on' : 'timestamp=off',
      ].filter(Boolean).join('\n'))
      .setPlaceholder('text=Your footer\ntimestamp=on');

    modal.addComponents(
      new ActionRowBuilder().addComponents(title),
      new ActionRowBuilder().addComponents(description),
      new ActionRowBuilder().addComponents(color),
      new ActionRowBuilder().addComponents(media),
      new ActionRowBuilder().addComponents(footer),
    );

    return interaction.showModal(modal);
  },
};
