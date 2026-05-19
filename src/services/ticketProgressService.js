/**
 * ticketProgressService.js
 *
 * Provides two features tied to the ticket progress channel
 * (settings.tickets.progressChannelId):
 *
 *   1. Progress tracking  — post a rich embed when a ticket is created,
 *      then EDIT that same embed whenever its status changes (claimed,
 *      closed, deleted).  Each ticket gets exactly one message in the
 *      progress channel; the message is updated in-place so the channel
 *      stays readable like the screenshot the user provided.
 *
 *   2. Auto-transcript    — whenever a ticket is closed or deleted, and
 *      settings.tickets.transcriptChannelId is set, automatically generate
 *      and post an HTML transcript without requiring the /transcript command.
 *
 * Data stored per ticket (inside the ticket record):
 *   ticket.progress.messageId   — ID of the progress-channel embed message
 *   ticket.progress.channelId   — snapshot of the progress channel ID at
 *                                 creation time (so we can edit later even
 *                                 if the setting is changed)
 *
 * This module is intentionally side-effect-free until explicitly called.
 * Nothing here registers event listeners — callers in the button/select
 * handlers invoke the exported functions at the right moment.
 */

'use strict';

const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { getGuildSettings } = require('../utils/settings');
const { getTicket, setTicket } = require('../stores/ticketData');
const { logger } = require('../helpers/logger');
const { resolveLogChannel } = require('../services/logService');

// ── Status display helpers ────────────────────────────────────────────────────

const STATUS_META = {
  open:      { label: '⏳ ĐANG THỰC HIỆN', color: 0xf59e0b }, // amber  — pending/in-work
  claimed:   { label: '⏳ ĐANG THỰC HIỆN', color: 0x3b82f6 }, // blue   — claimed & being worked
  closed:    { label: '✅ ĐÃ HOÀN THÀNH',  color: 0x22c55e }, // green  — closed
  deleted:   { label: '✅ ĐÃ HOÀN THÀNH',  color: 0x22c55e }, // green  — deleted/done
  cancelled: { label: '❌ ĐƠN BỊ HUỶ',     color: 0xef4444 }, // red    — no staff claimed
};

function getStatusMeta(status) {
  return STATUS_META[status] ?? STATUS_META.open;
}

// ── Embed builder ─────────────────────────────────────────────────────────────

/**
 * Build the progress embed that appears in the progress channel.
 *
 * Matches the style from the screenshot:
 *   @user  🎫 x1 TypeLabel  ⏳ ĐANG THỰC HIỆN  🔒 #channel
 */
function buildProgressEmbed({ ticket, channel, status, claimedBy, guildName }) {
  const { label: statusLabel, color } = getStatusMeta(status);
  const typeLabel = ticket.typeLabel ?? ticket.typeValue ?? 'Support';
  const openerId  = ticket.openerId ?? ticket.ownerId ?? null;
  const openedTs  = ticket.createdAt ? Math.floor(ticket.createdAt / 1000) : Math.floor(Date.now() / 1000);

  // Build description line similar to the screenshot format
  const descParts = [];

  if (openerId) descParts.push(`**Opened by:** <@${openerId}>`);
  descParts.push(`**Type:** ${typeLabel}`);
  descParts.push(`**Status:** ${statusLabel}`);

  if (channel) {
    descParts.push(`**Channel:** <#${channel.id}>`);
  }

  if (claimedBy) {
    descParts.push(`**Claimed by:** <@${claimedBy}>`);
  }

  descParts.push(`**Opened:** <t:${openedTs}:R>`);

  if (status === 'closed' || status === 'deleted') {
    const closedTs = ticket.sla?.closedAt
      ? Math.floor(ticket.sla.closedAt / 1000)
      : Math.floor(Date.now() / 1000);
    descParts.push(`**Closed:** <t:${closedTs}:R>`);
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setDescription(descParts.join('\n'))
    .setTimestamp();

  if (guildName) embed.setFooter({ text: guildName });

  return embed;
}

// ── Core: post or edit the progress message ──────────────────────────────────

/**
 * Post a new progress message in the progress channel and save its ID
 * into the ticket record.
 *
 * Called when a ticket is first created (status = 'open').
 *
 * @param {object} opts
 * @param {import('discord.js').Guild}       opts.guild
 * @param {import('discord.js').TextChannel} opts.channel   Ticket channel
 * @param {object}                           opts.ticket    Current ticket data
 * @param {string}                           opts.status    'open'
 */
async function postProgressMessage({ guild, channel, ticket, status = 'open' }) {
  try {
    const settings = await getGuildSettings(guild.id);
    const progressChannelId = settings?.tickets?.progressChannelId ?? null;
    if (!progressChannelId) return; // feature not configured

    const progressChannel = await resolveLogChannel(guild, progressChannelId);
    if (!progressChannel) return;

    const embed = buildProgressEmbed({
      ticket,
      channel,
      status,
      claimedBy: ticket.claimedBy ?? null,
      guildName: guild.name,
    });

    const msg = await progressChannel.send({ embeds: [embed] });

    // Persist progress message reference into the ticket record
    const latest = await getTicket(guild.id, channel.id);
    if (latest) {
      await setTicket(guild.id, channel.id, {
        ...latest,
        progress: {
          messageId: msg.id,
          channelId: progressChannelId,
        },
      });
    }
  } catch (err) {
    logger.warn({ err, guildId: guild.id, channelId: channel?.id }, '[TICKET-PROGRESS] Failed to post progress message');
  }
}

/**
 * Edit the existing progress message for a ticket (status change).
 *
 * Called on claim, close, delete.
 *
 * @param {object} opts
 * @param {import('discord.js').Guild}       opts.guild
 * @param {import('discord.js').TextChannel} opts.channel   Ticket channel
 * @param {object}                           opts.ticket    Updated ticket data (already patched)
 * @param {string}                           opts.status    'claimed' | 'closed' | 'deleted'
 * @param {string|null}                      opts.claimedBy Discord user ID of claimer
 */
async function updateProgressMessage({ guild, channel, ticket, status, claimedBy = null }) {
  try {
    const progress = ticket?.progress;
    if (!progress?.messageId || !progress?.channelId) return; // no progress message on record

    const progressChannel = await resolveLogChannel(guild, progress.channelId);
    if (!progressChannel) return;

    const msg = await progressChannel.messages.fetch(progress.messageId).catch(() => null);
    if (!msg) return;

    const embed = buildProgressEmbed({
      ticket,
      channel,
      status,
      claimedBy: claimedBy ?? ticket.claimedBy ?? null,
      guildName: guild.name,
    });

    await msg.edit({ embeds: [embed] });
  } catch (err) {
    logger.warn({ err, guildId: guild.id }, '[TICKET-PROGRESS] Failed to update progress message');
  }
}

// ── Auto-transcript ───────────────────────────────────────────────────────────

/**
 * Escape HTML special characters.
 */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Paginate through all messages in a channel (up to `max`).
 * Returns messages sorted oldest-first.
 */
async function fetchAllMessages(channel, max = 500) {
  const out = [];
  let lastId;

  while (out.length < max) {
    const opts = { limit: 100 };
    if (lastId) opts.before = lastId;
    const batch = await channel.messages.fetch(opts).catch(() => null);
    if (!batch || batch.size === 0) break;

    const arr = [...batch.values()];
    out.push(...arr);
    lastId = arr[arr.length - 1].id;
    if (batch.size < 100) break;
  }

  out.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return out.slice(-max);
}

/**
 * Build an HTML transcript from the channel's messages.
 */
function buildHtmlTranscript(guild, channel, ticket, messages) {
  const title  = `${guild.name} — #${channel.name}`;
  const opener = ticket?.openerId ?? 'unknown';
  const type   = ticket?.typeLabel ?? ticket?.typeValue ?? 'Support';
  const meta   = `Type: ${type} | Opener: ${opener} | Created: ${ticket?.createdAt ? new Date(ticket.createdAt).toLocaleString() : 'n/a'}`;

  const rows = messages.map((m) => {
    const author  = m.member?.displayName || m.author?.tag || 'Unknown';
    const time    = new Date(m.createdTimestamp).toLocaleString();
    const content = esc(m.content || '');
    const atts    = [...m.attachments.values()]
      .map((a) => `<a href="${esc(a.url)}" target="_blank">${esc(a.name ?? 'attachment')}</a>`)
      .join(' · ');
    const embeds  = (m.embeds || []).length
      ? `<div class="embeds">[${m.embeds.length} embed(s)]</div>`
      : '';

    return `
      <div class="msg">
        <div class="head">
          <span class="author">${esc(author)}</span>
          <span class="time">${esc(time)}</span>
        </div>
        <div class="content">${content ? content.replace(/\n/g, '<br>') : '<span class="muted">(no text)</span>'}</div>
        ${atts ? `<div class="att">${atts}</div>` : ''}
        ${embeds}
      </div>`;
  }).join('\n');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<style>
body{font-family:system-ui,Segoe UI,Arial,sans-serif;background:#0b0f19;color:#e5e7eb;margin:0;padding:18px}
.header{padding:14px 16px;background:#111827;border:1px solid #1f2937;border-radius:10px;margin-bottom:12px}
.h1{font-size:18px;font-weight:800;margin:0 0 6px}
.meta{font-size:12px;color:#9ca3af}
.msg{padding:12px 14px;border:1px solid #1f2937;background:#0f172a;border-radius:10px;margin:10px 0}
.head{display:flex;gap:10px;align-items:baseline}
.author{font-weight:800}
.time{font-size:12px;color:#9ca3af}
.content{margin-top:6px;line-height:1.35}
.att{margin-top:8px;font-size:12px}
.att a{color:#93c5fd;text-decoration:none}
.muted{color:#9ca3af}
.embeds{margin-top:8px;font-size:12px;color:#cbd5e1}
</style>
</head>
<body>
  <div class="header">
    <div class="h1">${esc(title)}</div>
    <div class="meta">${esc(meta)}</div>
  </div>
  ${rows || '<div class="msg"><span class="muted">No messages found.</span></div>'}
</body>
</html>`;
}

/**
 * Generate and post the HTML transcript to the transcript channel.
 * Silently no-ops if transcriptChannelId is not set.
 *
 * @param {object} opts
 * @param {import('discord.js').Guild}       opts.guild
 * @param {import('discord.js').TextChannel} opts.channel   Ticket channel (may be about to be deleted)
 * @param {object}                           opts.ticket    Ticket record (already stamped with closedAt)
 * @param {string}                           opts.closedBy  User ID who triggered close/delete
 */
async function sendAutoTranscript({ guild, channel, ticket, closedBy }) {
  try {
    const settings = await getGuildSettings(guild.id);
    const transcriptChannelId = settings?.tickets?.transcriptChannelId ?? null;
    if (!transcriptChannelId) return; // feature not configured

    const transcriptChannel = await resolveLogChannel(guild, transcriptChannelId);
    if (!transcriptChannel) return;

    const messages = await fetchAllMessages(channel, 500);
    const html = buildHtmlTranscript(guild, channel, ticket, messages);

    const fileName   = `transcript-${channel.name}-${Date.now()}.html`;
    const attachment = new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: fileName });

    const opener = ticket.openerId ?? ticket.ownerId ?? null;
    const type   = ticket.typeLabel ?? ticket.typeValue ?? 'Support';

    await transcriptChannel.send({
      content: [
        `📄 **Auto-transcript** — <#${channel.id}>`,
        opener ? `👤 Opener: <@${opener}>` : null,
        `🎫 Type: **${type}**`,
        closedBy ? `🔒 Closed by: <@${closedBy}>` : null,
      ].filter(Boolean).join(' · '),
      files: [attachment],
    });
  } catch (err) {
    logger.warn({ err, guildId: guild.id }, '[TICKET-PROGRESS] Failed to send auto-transcript');
  }
}

module.exports = {
  postProgressMessage,
  updateProgressMessage,
  cancelProgressMessage,
  sendAutoTranscript,
  buildProgressEmbed,  // exported for tests
  getStatusMeta,       // exported for tests
};

/**
 * Mark a ticket's progress embed as cancelled (no staff claimed it).
 * Also sends auto-transcript if configured.
 *
 * @param {object} opts
 * @param {import('discord.js').Guild}       opts.guild
 * @param {import('discord.js').TextChannel} opts.channel
 * @param {object}                           opts.ticket
 */
async function cancelProgressMessage({ guild, channel, ticket }) {
  await updateProgressMessage({ guild, channel, ticket, status: 'cancelled' });
  await sendAutoTranscript({ guild, channel, ticket, closedBy: null });
}
