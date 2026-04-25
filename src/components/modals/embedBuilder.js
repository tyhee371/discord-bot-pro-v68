const { EmbedBuilder, MessageFlags } = require('discord.js');

function parseColor(input) {
  if (!input) return null;
  const s = input.trim().toLowerCase();
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
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = val;
  }
  return out;
}


function extractUrlsFromLines(raw) {
  if (!raw) return [];
  const lines = String(raw).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines.filter(isHttpUrl);
}

function parseFooterSmart(raw) {
  const footer = parseKeyValueBlock(raw);
  let footerText = footer.text || footer.footer || '';
  let ts = parseBool(footer.timestamp || footer.ts, false);

  // Allow plain footer text without keys
  if (!footerText) {
    const lines = String(raw || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const low = line.toLowerCase();
      if (low.startsWith('timestamp') || low.startsWith('ts')) {
        const val = line.split(/[:=\s]+/).slice(1).join(' ').trim();
        if (val) ts = parseBool(val, ts);
        continue;
      }
      if (!footerText) footerText = line;
    }
  }

  return { footerText, ts };
}


function parseBool(raw, def = false) {
  if (raw == null || raw === '') return def;
  const s = String(raw).trim().toLowerCase();
  return ['1','true','yes','y','on','enable','enabled'].includes(s);
}

module.exports = {
  id: 'embedBuilder',
  async execute(interaction) {
    const channelId = interaction.customId.split(':')[1];

    const title = interaction.fields.getTextInputValue('title')?.trim() ?? '';
    const description = interaction.fields.getTextInputValue('description')?.trim() ?? '';
    const colorRaw = interaction.fields.getTextInputValue('color')?.trim() ?? '';
    const mediaRaw = interaction.fields.getTextInputValue('media')?.trim() ?? '';
    const footerRaw = interaction.fields.getTextInputValue('footer')?.trim() ?? '';

    const embed = new EmbedBuilder();
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);

    const color = parseColor(colorRaw);
    if (color !== null) embed.setColor(color);

    
const media = parseKeyValueBlock(mediaRaw);
let thumb = media.thumbnail || media.thumb || media.thumbnail_url || media.thumbnailurl;
let img = media.image || media.image_url || media.imageurl;

// Allow pasting URL(s) without keys:
// - 1 URL => image
// - 2 URLs => image, thumbnail
if (!thumb && !img) {
  const urls = extractUrlsFromLines(mediaRaw);
  if (urls.length === 1) img = urls[0];
  else if (urls.length >= 2) {
    img = urls[0];
    thumb = urls[1];
  }
}

    if (thumb) {
      if (!isHttpUrl(thumb)) return interaction.reply({ content: 'Invalid thumbnail URL (must be http/https).', flags: MessageFlags.Ephemeral });
      embed.setThumbnail(thumb);
    }
    if (img) {
      if (!isHttpUrl(img)) return interaction.reply({ content: 'Invalid image URL (must be http/https).', flags: MessageFlags.Ephemeral });
      embed.setImage(img);
    }

    const { footerText, ts } = parseFooterSmart(footerRaw);

    if (footerText) embed.setFooter({ text: footerText });
    if (ts) embed.setTimestamp();

    const ch = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!ch) return interaction.reply({ content: 'Channel not found.', flags: MessageFlags.Ephemeral });

    await ch.send({ embeds: [embed] }).catch((e) => console.error('[EMBED] send failed:', e));
    return interaction.reply({ content: '✅ Embed sent.', flags: MessageFlags.Ephemeral });
  },
};
