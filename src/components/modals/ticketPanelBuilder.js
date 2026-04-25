const { EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/settings');

function parseColor(input) {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
    return parseInt(hex, 16);
  }
  if (/^[0-9a-f]{6}$/i.test(s)) return parseInt(s, 16);
  if (/^\d+$/.test(s)) return Number(s);
  return null;
}

function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseKeyValueBlock(raw) {
  const out = {};
  if (!raw) return out;

  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Support both key=value and key: value
    const eq = line.indexOf('=');
    const colon = line.indexOf(':');
    const idx = eq !== -1 ? eq : colon;
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = val;
  }

  return out;
}

function parseBool(raw, def = false) {
  if (raw == null || raw === '') return def;
  const s = String(raw).trim().toLowerCase();
  return ['1','true','yes','y','on','enable','enabled'].includes(s);
}

function getBuilders(settings) {
  const b = settings?.tickets?.builders;
  return (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
}

function buildPreview(titleFallback, descFallback, embedCfg) {
  const preview = new EmbedBuilder()
    .setTitle(titleFallback || 'Support Tickets')
    .setDescription(descFallback || 'Choose a ticket type:');

  if (embedCfg.color != null) preview.setColor(embedCfg.color);
  if (embedCfg.thumbnailUrl) preview.setThumbnail(embedCfg.thumbnailUrl);
  if (embedCfg.imageUrl) preview.setImage(embedCfg.imageUrl);
  if (embedCfg.footerText) preview.setFooter({ text: embedCfg.footerText });
  if (embedCfg.timestamp) preview.setTimestamp();
  return preview;
}

module.exports = {
  id: 'ticketPanelBuilder',

  async execute(interaction) {
    const guildId = interaction.guildId;
    const settings = await getGuildSettings(guildId);

    // customId formats:
    // - ticketPanelBuilder:<builderId>:<channelId>:<messageId>
    // - ticketPanelBuilder:legacy:<channelId>:<messageId>  (fallback)
    const parts = String(interaction.customId).split(':');
    const modeOrBuilderId = parts[1] || 'legacy';
    const chId = parts[2];
    const msgId = parts[3];

    const title = interaction.fields.getTextInputValue('title')?.trim() ?? '';
    const description = interaction.fields.getTextInputValue('description')?.trim() ?? '';
    const colorRaw = interaction.fields.getTextInputValue('color')?.trim() ?? '';
    const mediaRaw = interaction.fields.getTextInputValue('media')?.trim() ?? '';
    const footerRaw = interaction.fields.getTextInputValue('footer')?.trim() ?? '';

    const color = parseColor(colorRaw);
    if (colorRaw && color == null) {
      return interaction.reply({ content: 'Invalid color. Use #RRGGBB or a decimal number.', flags: MessageFlags.Ephemeral });
    }

    const media = parseKeyValueBlock(mediaRaw);
    // Be forgiving: if admin pastes a single URL line without key, treat it as image
    const mediaHasKeys = Object.keys(media).length > 0;
    const mediaSingleUrl = (!mediaHasKeys && isHttpUrl(mediaRaw)) ? mediaRaw.trim() : '';
    const thumb = media.thumbnail || media.thumb || media.thumbnail_url || media.thumbnailurl || '';
    const img = media.image || media.image_url || media.imageurl || mediaSingleUrl || '';

    if (thumb && !isHttpUrl(thumb)) return interaction.reply({ content: 'Invalid thumbnail URL (must be http/https).', flags: MessageFlags.Ephemeral });
    if (img && !isHttpUrl(img)) return interaction.reply({ content: 'Invalid image URL (must be http/https).', flags: MessageFlags.Ephemeral });

    const footer = parseKeyValueBlock(footerRaw);
    const footerHasKeys = Object.keys(footer).length > 0;
    const footerPlainText = (!footerHasKeys && footerRaw && footerRaw.trim() && !footerRaw.includes('=') && !footerRaw.includes(':')) ? footerRaw.trim() : '';
    const footerText = footer.text || footer.footer || footerPlainText || '';
    const timestamp = parseBool(footer.timestamp || footer.ts, false);

    const nextEmbed = {
      title: title || null,
      description: description || null,
      color: color ?? null,
      thumbnailUrl: thumb || null,
      imageUrl: img || null,
      footerText: footerText || null,
      timestamp: !!timestamp,
    };

    // Persist
    if (modeOrBuilderId === 'legacy') {
      await setGuildSettings(guildId, { tickets: { panel: { embed: nextEmbed } } });
    } else {
      const builderId = modeOrBuilderId;
      const builders = getBuilders(settings);
      const builder = builders[builderId];
      if (!builder) {
        return interaction.reply({ content: `❌ Builder \`${builderId}\` no longer exists.`, flags: MessageFlags.Ephemeral });
      }

      const nextBuilder = {
        ...builder,
        name: nextEmbed.title || builder.name || 'Support Tickets',
        embed: nextEmbed,
        updatedAt: Date.now(),
      };

      await setGuildSettings(guildId, { tickets: { builders: { ...builders, [builderId]: nextBuilder } } });
    }

    // Build preview
    const titleFallback = nextEmbed.title || (modeOrBuilderId === 'legacy' ? (settings?.tickets?.panel?.title || 'Support Tickets') : 'Support Tickets');
    const descFallback = nextEmbed.description || (modeOrBuilderId === 'legacy' ? (settings?.tickets?.panel?.description || 'Choose a ticket type:') : 'Choose a ticket type:');
    const preview = buildPreview(titleFallback, descFallback, nextEmbed);

    // If this modal was launched from the panel builder message, update that message preview too
    if (chId && msgId) {
      const ch = await interaction.guild.channels.fetch(chId).catch(() => null);
      if (ch && ch.isTextBased?.()) {
        const msg = await ch.messages.fetch(msgId).catch(() => null);
        if (msg) {
          const builderId = modeOrBuilderId === 'legacy' ? null : modeOrBuilderId;
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(builderId ? `ticketPanel:edit:${builderId}` : 'ticketPanel:edit:legacy')
              .setLabel('Edit Panel Embed')
              .setStyle(ButtonStyle.Primary),
          );
          await msg.edit({ embeds: [preview], components: [row] }).catch(() => {});
        }
      }
    }

    return interaction.reply({ content: '✅ Ticket panel embed updated.', embeds: [preview], flags: MessageFlags.Ephemeral });
  },
};
