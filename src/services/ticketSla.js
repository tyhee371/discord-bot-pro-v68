/**
 * ticketSla.js — SLA (service-level) timing for tickets.
 *
 * Tracks three key timestamps:
 *   openedAt   — when the ticket channel was created
 *   claimedAt  — when a staff member first claimed it
 *   closedAt   — when the ticket was closed/deleted
 *
 * Derived metrics:
 *   timeToClaimMs  = claimedAt - openedAt
 *   timeToCloseMs  = closedAt  - openedAt
 *   handleTimeMs   = closedAt  - claimedAt  (time staff spent on it)
 *
 * All values are stored alongside the ticket record in ticketData.js.
 * This module provides helpers to stamp events and build the receipt embed.
 */

const { EmbedBuilder } = require('discord.js');

/**
 * Format milliseconds into a human-readable duration string.
 * e.g. 125000 → "2m 5s"
 */
function fmtDuration(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/**
 * Stamp ticket as opened.
 * @param {object} ticket  Current ticket record
 * @returns {object}       Patched ticket with sla.openedAt set
 */
function stampOpened(ticket) {
  return { ...ticket, sla: { ...(ticket.sla ?? {}), openedAt: ticket.sla?.openedAt ?? Date.now() } };
}

/**
 * Stamp ticket as claimed.
 * @param {object} ticket
 * @param {string} claimedBy  Discord user ID
 * @returns {object}
 */
function stampClaimed(ticket, claimedBy) {
  const sla = { ...(ticket.sla ?? {}) };
  if (!sla.claimedAt) {
    sla.claimedAt = Date.now();
    sla.claimedBy = claimedBy ?? null;
  }
  return { ...ticket, claimedBy: claimedBy ?? ticket.claimedBy, sla };
}

/**
 * Stamp ticket as closed.
 * @param {object} ticket
 * @param {string} closedBy  Discord user ID
 * @returns {object}
 */
function stampClosed(ticket, closedBy) {
  const sla = { ...(ticket.sla ?? {}) };
  if (!sla.closedAt) {
    sla.closedAt = Date.now();
    sla.closedBy = closedBy ?? null;
  }
  return { ...ticket, sla };
}

/**
 * Derive SLA metrics from a stamped ticket.
 * @param {object} ticket
 */
function getSlaMetrics(ticket) {
  const sla = ticket.sla ?? {};
  const openedAt = sla.openedAt ?? ticket.createdAt ?? null;
  const claimedAt = sla.claimedAt ?? null;
  const closedAt = sla.closedAt ?? null;

  return {
    openedAt,
    claimedAt,
    closedAt,
    timeToClaimMs: openedAt && claimedAt ? claimedAt - openedAt : null,
    timeToCloseMs: openedAt && closedAt ? closedAt - openedAt : null,
    handleTimeMs: claimedAt && closedAt ? closedAt - claimedAt : null,
    claimedBy: sla.claimedBy ?? ticket.claimedBy ?? null,
    closedBy: sla.closedBy ?? null,
  };
}

/**
 * Build a rich close-receipt embed with SLA information.
 *
 * @param {object} opts
 * @param {object}  opts.ticket         Ticket record
 * @param {string}  opts.channelName    Name of the ticket channel
 * @param {object}  opts.guild          Discord Guild object
 * @param {boolean} opts.includeTranscriptLink
 * @param {string}  [opts.transcriptUrl]
 */
function buildCloseReceiptEmbed({ ticket, channelName, guild, transcriptUrl }) {
  const metrics = getSlaMetrics(ticket);
  const type = ticket.typeLabel ?? ticket.typeValue ?? 'Support';
  const serial = ticket.serial ? `#${ticket.serial}` : '';

  const emb = new EmbedBuilder()
    .setTitle(`🎫 Ticket Closed ${serial ? `— ${serial}` : ''}`)
    .setDescription(`**${type}** ticket in **${guild.name}**`)
    .setTimestamp(metrics.closedAt ? new Date(metrics.closedAt) : undefined)
    .setColor(0x22c55e);

  const fields = [];

  if (ticket.openerId) {
    fields.push({ name: '👤 Opener', value: `<@${ticket.openerId}>`, inline: true });
  }
  if (metrics.claimedBy) {
    fields.push({ name: '🙋 Claimed By', value: `<@${metrics.claimedBy}>`, inline: true });
  }
  if (metrics.closedBy) {
    fields.push({ name: '🔒 Closed By', value: `<@${metrics.closedBy}>`, inline: true });
  }

  if (metrics.openedAt) {
    fields.push({ name: '🕐 Opened', value: `<t:${Math.floor(metrics.openedAt / 1000)}:F>`, inline: true });
  }
  if (metrics.claimedAt) {
    fields.push({ name: '⏱️ Time to Claim', value: fmtDuration(metrics.timeToClaimMs), inline: true });
  }
  if (metrics.closedAt) {
    fields.push({ name: '⏳ Total Open Time', value: fmtDuration(metrics.timeToCloseMs), inline: true });
  }
  if (metrics.handleTimeMs !== null) {
    fields.push({ name: '🛠️ Handle Time', value: fmtDuration(metrics.handleTimeMs), inline: true });
  }

  if (transcriptUrl) {
    fields.push({ name: '🧾 Transcript', value: `[View Transcript](${transcriptUrl})`, inline: false });
  }

  if (fields.length) emb.addFields(fields);
  emb.setFooter({ text: `Channel: #${channelName}` });

  return emb;
}

module.exports = { stampOpened, stampClaimed, stampClosed, getSlaMetrics, buildCloseReceiptEmbed, fmtDuration };
