const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { safeDefer } = require('../../utils/safeReply');
const { readSettings, putGuildSettings } = require('../../utils/settings');

// Guard: validate readSettings resolved correctly (spec 1.1)
if (typeof readSettings !== 'function') {
  throw new Error('[rolepanelPanelBuilder.js] readSettings is not defined - check settings.js exports');
}

function getBuilders(settings) {
  const b = settings?.rolePanel?.builders;
  return (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
}

function parseColor(raw) {
  if (!raw) return undefined;
  const s = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return parseInt(s.slice(1), 16);
  if (/^[0-9]+$/.test(s)) return parseInt(s, 10);
  const hex = s.replace('#', '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return parseInt(hex, 16);
  return undefined;
}

module.exports = {
  id: 'rolepanelPanelBuilder',
  async execute(interaction) {
    await safeDefer(interaction, { ephemeral: true });

    // customId: rolepanelPanelBuilder:<builderId>:<channelId>:<messageId>
    const parts = interaction.customId.split(':');
    const builderId = parts[1] || 'default';
    const targetChannelId = parts[2];
    const targetMessageId = parts[3];

    const titleVal       = interaction.fields.getTextInputValue('title')?.trim() || '';
    const descriptionVal = interaction.fields.getTextInputValue('description')?.trim() || '';
    const colorRaw       = interaction.fields.getTextInputValue('color')?.trim() || '';
    const mediaRaw       = interaction.fields.getTextInputValue('media')?.trim() || '';
    const footerRaw      = interaction.fields.getTextInputValue('footer')?.trim() || '';

    // Parse media lines
    let thumbnailUrl = '', imageUrl = '';
    for (const line of mediaRaw.split('\n').map(l => l.trim()).filter(Boolean)) {
      if (line.startsWith('thumbnail=')) thumbnailUrl = line.slice(10).trim();
      else if (line.startsWith('image=')) imageUrl = line.slice(6).trim();
    }

    // Parse footer lines
    let footerText = '', timestamp = false;
    for (const line of footerRaw.split('\n').map(l => l.trim()).filter(Boolean)) {
      if (line.startsWith('text=')) footerText = line.slice(5).trim();
      else if (line === 'timestamp=on') timestamp = true;
      else if (line === 'timestamp=off') timestamp = false;
    }

    const embedCfg = {
      title: titleVal || undefined,
      description: descriptionVal || undefined,
      color: parseColor(colorRaw),
      thumbnailUrl: thumbnailUrl || undefined,
      imageUrl: imageUrl || undefined,
      footerText: footerText || undefined,
      timestamp,
    };

    // Persist to builder
    const settings = await readSettings(interaction.guildId);
    const builders = getBuilders(settings);
    const builder = builders[builderId];
    if (!builder) return interaction.editReply({ content: `\u274c Builder \`${builderId}\` not found.` });

    const nextSettings = JSON.parse(JSON.stringify(settings));
    nextSettings.rolePanel.builders[builderId].embed = embedCfg;
    nextSettings.rolePanel.builders[builderId].name = titleVal || builder.name;
    nextSettings.rolePanel.builders[builderId].updatedAt = Date.now();
    await putGuildSettings(interaction.guildId, nextSettings);

    // Rebuild the live preview embed and update the original message
    const updatedBuilder = nextSettings.rolePanel.builders[builderId];
    const previewEmbed = new EmbedBuilder();
    if (embedCfg.title) previewEmbed.setTitle(embedCfg.title.slice(0, 256));
    if (embedCfg.description) previewEmbed.setDescription(embedCfg.description.slice(0, 4096));
    if (embedCfg.color != null) { try { previewEmbed.setColor(embedCfg.color); } catch {} }
    if (embedCfg.thumbnailUrl) previewEmbed.setThumbnail(embedCfg.thumbnailUrl);
    if (embedCfg.imageUrl) previewEmbed.setImage(embedCfg.imageUrl);
    if (embedCfg.footerText) previewEmbed.setFooter({ text: embedCfg.footerText.slice(0, 2048) });
    if (embedCfg.timestamp) previewEmbed.setTimestamp(new Date());
    if (!embedCfg.title && !embedCfg.description) {
      previewEmbed.setTitle(updatedBuilder.name || 'Pick Your Roles').setDescription('Configure this builder with the Edit button below.');
    }

    // Try to update the original preview message
    if (targetChannelId && targetMessageId) {
      try {
        const ch = interaction.guild.channels.cache.get(targetChannelId) || await interaction.guild.channels.fetch(targetChannelId).catch(() => null);
        if (ch) {
          const msg = await ch.messages.fetch(targetMessageId).catch(() => null);
          if (msg) {
            const editRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`rolepanelPanel:edit:${builderId}`)
                .setLabel('Edit Panel Embed')
                .setStyle(ButtonStyle.Primary),
            );
            await msg.edit({ embeds: [previewEmbed], components: [editRow] }).catch(() => {});
          }
        }
      } catch {}
    }

    return interaction.editReply({ content: `\u2705 Embed for builder \`${builderId}\` updated.` });
  },
};
