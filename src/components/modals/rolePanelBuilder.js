const { EmbedBuilder, MessageFlags } = require('discord.js');
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

  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
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
  return ['1', 'true', 'yes', 'y', 'on', 'enable', 'enabled'].includes(s);
}

module.exports = {
  id: 'rolePanelBuilder',

  async execute(interaction) {
    const guildId = interaction.guildId;
    const settings = await getGuildSettings(guildId);
    const panel = settings?.rolePanel?.panel ?? {};
    const current = panel.embed ?? {};

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
    const mediaHasKeys = Object.keys(media).length > 0;
    const mediaSingleUrl = !mediaHasKeys && isHttpUrl(mediaRaw) ? mediaRaw.trim() : '';
    const thumb = media.thumbnail || media.thumb || media.thumbnail_url || media.thumbnailurl || '';
    const img = media.image || media.image_url || media.imageurl || mediaSingleUrl || '';

    if (thumb && !isHttpUrl(thumb)) return interaction.reply({ content: 'Invalid thumbnail URL (must be http/https).', flags: MessageFlags.Ephemeral });
    if (img && !isHttpUrl(img)) return interaction.reply({ content: 'Invalid image URL (must be http/https).', flags: MessageFlags.Ephemeral });

    const footer = parseKeyValueBlock(footerRaw);
    const footerHasKeys = Object.keys(footer).length > 0;
    const footerPlainText = !footerHasKeys && footerRaw && footerRaw.trim() && !footerRaw.includes('=') && !footerRaw.includes(':') ? footerRaw.trim() : '';
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

    await setGuildSettings(guildId, { rolePanel: { panel: { embed: nextEmbed } } });

    const preview = new EmbedBuilder()
      .setTitle(nextEmbed.title || 'Pick Your Roles')
      .setDescription(nextEmbed.description || 'Select roles from the menu below.')
      .setColor(nextEmbed.color ?? null);

    if (nextEmbed.thumbnailUrl) preview.setThumbnail(nextEmbed.thumbnailUrl);
    if (nextEmbed.imageUrl) preview.setImage(nextEmbed.imageUrl);
    if (nextEmbed.footerText) preview.setFooter({ text: nextEmbed.footerText });
    if (nextEmbed.timestamp) preview.setTimestamp(new Date());

    return interaction.reply({ content: '✅ Updated role panel embed.', embeds: [preview], flags: MessageFlags.Ephemeral });
  },
};
