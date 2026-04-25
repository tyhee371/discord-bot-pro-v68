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

// ── Embed builders ────────────────────────────────────────────────────────────
function buildActiveEmbed(g) {
  const embed = new EmbedBuilder()
    .setColor(0xF1C40F)
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

  return embed;
}

function buildEndedEmbed(g, winners) {
  const embed = new EmbedBuilder()
    .setColor(winners.length ? 0x2ECC71 : 0x95A5A6)
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

module.exports = {
  parseDuration,
  formatTimeLeft,
  formatTimestamp,
  formatTimestampFull,
  pickWinners,
  buildActiveEmbed,
  buildEndedEmbed,
  buildEntryButton,
};
