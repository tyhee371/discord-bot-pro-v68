/**
 * Shared helpers for building giveaway embeds, picking winners, parsing durations.
 */
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// ── Duration parser ───────────────────────────────────────────────────────────
// Supports: 10s, 10m, 1h, 1d, 1h30m, 2d12h, etc.
function parseDuration(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim().toLowerCase();
  let ms = 0;
  const re = /(\d+)\s*(d|h|m|s)/g;
  let match;
  let found = false;
  while ((match = re.exec(s)) !== null) {
    found = true;
    const val = parseInt(match[1], 10);
    switch (match[2]) {
      case 'd': ms += val * 86400000; break;
      case 'h': ms += val * 3600000; break;
      case 'm': ms += val * 60000; break;
      case 's': ms += val * 1000; break;
    }
  }
  return found && ms > 0 ? ms : null;
}

// ── Time formatter ────────────────────────────────────────────────────────────
function formatTimeLeft(endTime) {
  const diff = endTime - Date.now();
  if (diff <= 0) return 'Ended';
  const s = Math.floor(diff / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (sec && !d) parts.push(`${sec}s`);
  return parts.join(' ') || '< 1s';
}

function formatTimestamp(ms) {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

function formatTimestampFull(ms) {
  return `<t:${Math.floor(ms / 1000)}:F>`;
}

// ── Winner picker ─────────────────────────────────────────────────────────────
function pickWinners(entries, count) {
  if (!entries.length) return [];
  const pool = [...entries];
  const winners = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(idx, 1)[0]);
  }
  return winners;
}


// ── Color resolver ────────────────────────────────────────────────────────────
const COLOR_PRESETS = {
  gold:   0xF1C40F,
  red:    0xE74C3C,
  blue:   0x3498DB,
  green:  0x2ECC71,
  purple: 0x9B59B6,
  pink:   0xFF69B4,
  cyan:   0x1ABC9C,
  white:  0xFFFFFF,
};

/**
 * Resolve a color from a preset name or hex string.
 * Returns a numeric color value, or the default gold if invalid.
 */
function resolveColor(input, defaultColor = 0xF1C40F) {
  if (!input || input === 'none') return defaultColor;
  const preset = COLOR_PRESETS[String(input).toLowerCase()];
  if (preset) return preset;
  // Try hex string e.g. '#FF5733' or 'FF5733'
  const hex = String(input).replace(/^#/, '');
  const val = parseInt(hex, 16);
  return (!isNaN(val) && hex.length === 6) ? val : defaultColor;
}

// ── Embed builders ────────────────────────────────────────────────────────────
function buildActiveEmbed(g) {
  const embed = new EmbedBuilder()
    .setColor(resolveColor(g.color, 0xF1C40F))
    .setTitle(`🎉 ${g.prize}`)
    .setTimestamp(g.endTime);

  const lines = [];
  if (g.description) lines.push(g.description, '');
  lines.push(`⏰ **Ends:** ${formatTimestampFull(g.endTime)} (${formatTimestamp(g.endTime)})`);
  lines.push(`🏆 **Winners:** ${g.winnerCount}`);
  lines.push(`🎟️ **Entries:** ${g.entries.length}`);
  if (g.requiredRoleId) lines.push(`🔒 **Required Role:** <@&${g.requiredRoleId}>`);
  lines.push(`👤 **Hosted by:** <@${g.hostId}>`);
  embed.setDescription(lines.join('\n'));
  embed.setFooter({ text: `ID: ${g.id} • Click the button to enter!` });
  if (g.imageUrl) embed.setImage(g.imageUrl);

  return embed;
}

function buildEndedEmbed(g, winners) {
  const embed = new EmbedBuilder()
    .setColor(winners.length ? resolveColor(g.color, 0x2ECC71) : 0x95A5A6)
    .setTitle(`🎊 ${g.prize} — Giveaway Ended`)
    .setTimestamp();

  const lines = [];
  if (g.description) lines.push(g.description, '');
  lines.push(`⏰ **Ended:** ${formatTimestamp(g.endTime)}`);
  lines.push(`🎟️ **Total Entries:** ${g.entries.length}`);
  lines.push(`🏆 **Winners:** ${winners.length ? winners.map(id => `<@${id}>`).join(', ') : 'No valid entries'}`);
  if (g.requiredRoleId) lines.push(`🔒 **Required Role:** <@&${g.requiredRoleId}>`);
  lines.push(`👤 **Hosted by:** <@${g.hostId}>`);
  embed.setDescription(lines.join('\n'));
  embed.setFooter({ text: `ID: ${g.id}` });
  if (g.imageUrl) embed.setImage(g.imageUrl);

  return embed;
}

function buildEntryButton(giveawayId, disabled = false) {
  const btn = new ButtonBuilder()
    .setCustomId(`giveaway_enter:${giveawayId}`)
    .setLabel('🎉 Enter Giveaway')
    .setStyle(ButtonStyle.Success)
    .setDisabled(disabled);
  return new ActionRowBuilder().addComponents(btn);
}


// ── Entries pagination ────────────────────────────────────────────────────────
const ENTRIES_PER_PAGE = 10;

/**
 * Build a paginated embed showing giveaway participants.
 * @param {object} g       Giveaway data object
 * @param {number} page    Zero-based page index
 */
function buildEntriesEmbed(g, page) {
  const total   = g.entries.length;
  const pages   = Math.ceil(total / ENTRIES_PER_PAGE);
  const safePage = Math.max(0, Math.min(page, pages - 1));
  const start   = safePage * ENTRIES_PER_PAGE;
  const slice   = g.entries.slice(start, start + ENTRIES_PER_PAGE);

  const lines = slice.map((userId, idx) =>
    `${start + idx + 1}. <@${userId}>`
  );

  const embed = new EmbedBuilder()
    .setColor(resolveColor(g.color, 0xF1C40F))
    .setTitle(`👥 Entries — ${g.prize}`)
    .setDescription(lines.join('\n') || '*(none)*')
    .addFields(
      { name: 'Total Entries', value: String(total),           inline: true },
      { name: 'Winners',       value: String(g.winnerCount),   inline: true },
      { name: 'Status',        value: g.ended ? '🔴 Ended' : '🟢 Active', inline: true },
    )
    .setFooter({ text: `Page ${safePage + 1}/${pages} • Giveaway ID: ${g.id}` })
    .setTimestamp();

  return embed;
}

/**
 * Build the Previous / Next pagination row for the entries embed.
 * @param {string} giveawayId  Message ID of the giveaway
 * @param {number} page        Current zero-based page
 * @param {number} total       Total number of entries
 */
function buildEntriesRow(giveawayId, page, total) {
  const pages = Math.ceil(total / ENTRIES_PER_PAGE);

  const prev = new ButtonBuilder()
    .setCustomId(`giveawayEntries:${giveawayId}:${page - 1}`)
    .setLabel('◀ Previous')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page <= 0);

  const counter = new ButtonBuilder()
    .setCustomId(`giveawayEntries_noop:${giveawayId}:${page}`)
    .setLabel(`Page ${page + 1} / ${pages}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  const next = new ButtonBuilder()
    .setCustomId(`giveawayEntries:${giveawayId}:${page + 1}`)
    .setLabel('Next ▶')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= pages - 1);

  return new ActionRowBuilder().addComponents(prev, counter, next);
}

module.exports = {
  resolveColor,
  buildEntriesEmbed,
  buildEntriesRow,
  parseDuration,
  formatTimeLeft,
  formatTimestamp,
  formatTimestampFull,
  pickWinners,
  buildActiveEmbed,
  buildEndedEmbed,
  buildEntryButton,
};
