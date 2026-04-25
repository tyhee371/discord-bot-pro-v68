const {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const { getGuildSettings, readSettings } = require('../../utils/settings');

// Spec 1.1: validate readSettings is available
if (typeof readSettings !== 'function') {
  throw new Error('[ticketPanel] readSettings is not defined - check settings.js exports');
}

function getBuilders(settings) {
  const b = settings?.tickets?.builders;
  return (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
}

module.exports = {
  id: 'ticketPanel',

  async execute(interaction) {
    // Only handle edit
    if (!interaction.customId.startsWith('ticketPanel:edit')) return;

    const parts = interaction.customId.split(':'); // ticketPanel:edit:<builderId>
    const builderId = parts[2] || 'default';

    const settings = await getGuildSettings(interaction.guildId);
    const legacyPanel = settings?.tickets?.panel ?? {};
    const builders = getBuilders(settings);

    const builder = builders[builderId];
    if (!builder) {
      // Fallback to legacy (older servers), but still let admin edit legacy if needed
      // (This will update the legacy panel embed, not a builder.)
      const panel = legacyPanel;
      const embed = panel.embed ?? {};

      const modal = new ModalBuilder()
        .setCustomId(`ticketPanelBuilder:legacy:${interaction.channelId}:${interaction.message.id}`)
        .setTitle('Ticket Panel Embed');

      const title = new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Title (optional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue((embed.title ?? panel.title ?? '').slice(0, 256));

      const description = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setValue((embed.description ?? panel.description ?? '').slice(0, 4000));

      const color = new TextInputBuilder()
        .setCustomId('color')
        .setLabel('Color hex or decimal (optional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(embed.color != null ? String(embed.color) : '');

      const media = new TextInputBuilder()
        .setCustomId('media')
        .setLabel('Media URLs (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setValue([
          embed.thumbnailUrl ? `thumbnail=${embed.thumbnailUrl}` : '',
          embed.imageUrl ? `image=${embed.imageUrl}` : '',
        ].filter(Boolean).join('\n'))
        .setPlaceholder('thumbnail=https://...\nimage=https://...');

      const footer = new TextInputBuilder()
        .setCustomId('footer')
        .setLabel('Footer (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
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
    }

    const embed = builder.embed ?? {};

    const modal = new ModalBuilder()
      .setCustomId(`ticketPanelBuilder:${builderId}:${interaction.channelId}:${interaction.message.id}`)
      .setTitle('Ticket Panel Embed');

    const title = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Title (optional)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue((embed.title ?? builder.name ?? '').slice(0, 256));

    const description = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Description (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setValue((embed.description ?? '').slice(0, 4000));

    const color = new TextInputBuilder()
      .setCustomId('color')
      .setLabel('Color hex or decimal (optional)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(embed.color != null ? String(embed.color) : '');

    const media = new TextInputBuilder()
      .setCustomId('media')
      .setLabel('Media URLs (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setValue([
        embed.thumbnailUrl ? `thumbnail=${embed.thumbnailUrl}` : '',
        embed.imageUrl ? `image=${embed.imageUrl}` : '',
      ].filter(Boolean).join('\n'))
      .setPlaceholder('thumbnail=https://...\nimage=https://...');

    const footer = new TextInputBuilder()
      .setCustomId('footer')
      .setLabel('Footer (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
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
