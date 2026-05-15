const { stampClaimed } = require('./ticketSla');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { getStaffCandidates, chooseStaff } = require('../helpers/staffV2');
const { getTicket, setTicket } = require('../stores/ticketData');

const timers = new Map(); // channelId -> timeout

function clearTimer(channelId) {
  const t = timers.get(channelId);
  if (t) globalThis.clearTimeout(t);
  timers.delete(channelId);
}

/**
 * Returns claim timeout seconds from settings.
 * Used both as the delay between attempts AND (after final attempt) as the grace period before deletion.
 */
function getClaimTimeoutSeconds(settings) {
  const n = Number(settings?.tickets?.claimTimeoutSeconds ?? 60);
  // Don't allow too-fast loops; also avoid negative/NaN.
  if (!Number.isFinite(n)) return 60;
  return Math.max(10, n);
}

function buildTicketRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticketv2:claim').setLabel('Claim Ticket').setStyle(ButtonStyle.Success),
  );
}

function buildClaimEmbed({ typeLabel, attempt, chosenMention }) {
  const e = new EmbedBuilder()
    .setTitle(`Ticket: ${typeLabel}`)
    .setDescription(
      [
        'A staff member will claim your ticket soon. Please describe your issue.',
        '',
        'When the ticket is resolved, staff should run `/ticket-done` to post close/delete controls.',
        '',
        `**Claim attempt:** ${attempt}/3`,
        chosenMention ? `**Pinged staff:** ${chosenMention}` : '**Pinged staff:** (none available)',
      ].join('\n'),
    );
  return e;
}

/**
 * Edits the FIRST ticket message (the one created when the ticket channel is created)
 * so we don't spam the channel with "Claim Attempt" messages.
 *
 * NOTE: Discord does not reliably notify users on mention added via edit.
 * To still ping staff, we send a short ping-only message and delete it after a few seconds.
 */
async function editTicketMessage({ channel, ticket, embed, row, content }) {
  const messageId = ticket?.messageId ?? null;
  if (!messageId) return false;

  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (!msg) return false;

  await msg.edit({
    content,
    embeds: [embed],
    components: [row],
    allowedMentions: { parse: [], users: [], roles: [] },
  }).catch(() => null);

  return true;
}

async function pingAndDelete({ channel, chosen }) {
  if (!chosen) return;
  const pingMsg = await channel.send({
    content: `${chosen}`,
    allowedMentions: { users: [chosen.id], roles: [], parse: [] },
  }).catch(() => null);

  if (pingMsg) globalThis.setTimeout(() => pingMsg.delete().catch(() => {}), 4000);
}

async function scheduleNext({ guild, channel, settings, openerId, attempt, attemptedIds }) {
  const timeoutSeconds = getClaimTimeoutSeconds(settings);
  const delayMs = Math.max(1, Number(timeoutSeconds || 0) * 1000);

  clearTimer(channel.id);
  const handle = globalThis.setTimeout(async () => {
    try {
      const ticket = await getTicket(guild.id, channel.id);
      if (!ticket) return;
      if (ticket.claimedBy) return;

      await attemptClaim({ guild, channel, settings, openerId, attempt: attempt + 1, attemptedIds });
    } catch {}
  }, delayMs);

  timers.set(channel.id, handle);
}

async function attemptClaim({ guild, channel, settings, openerId, attempt = 1, attemptedIds = [] }) {
  const ticket = (await getTicket(guild.id, channel.id)) ?? {};
  if (ticket.claimedBy) return;

  const timeoutSeconds = getClaimTimeoutSeconds(settings);

  if (attempt > 3) {
    // Final outcome: unclaimed
    const opener = await guild.members.fetch(openerId).catch(() => null);
    if (opener) {
      opener.user
        .send(`⚠️ No staff claimed your ticket after 3 attempts. This ticket will be deleted in ${timeoutSeconds} seconds.`)
        .catch(() => {});
    }

    await channel.send(`⚠️ No staff claimed this ticket after 3 attempts. Deleting in **${timeoutSeconds}s**...`).catch(() => {});

    clearTimer(channel.id);
    globalThis.setTimeout(
      () => channel.delete('Ticket unclaimed (auto-delete)').catch(() => {}),
      Math.max(1, Number(timeoutSeconds || 0) * 1000)
    );
    return;
  }

  const members = await getStaffCandidates(guild, settings);
  const chosen = chooseStaff(members, attemptedIds, true);

  // rotate staff (avoid pinging same person repeatedly)
  if (chosen) attemptedIds = [...attemptedIds, chosen.id];

  // Persist attempt info for transparency/debugging
  const slaTicket = stampClaimed({ ...ticket }, ticket.claimedBy ?? null);
  await setTicket(guild.id, channel.id, {
    ...slaTicket,
    claim: {
      attempt,
      attemptedIds,
      lastPinged: chosen?.id ?? null,
    },
  });

  const typeLabel = ticket?.typeLabel || ticket?.typeValue || 'Support';
  const openerMention = openerId ? `<@${openerId}>` : '';
  const chosenMention = chosen ? `<@${chosen.id}>` : null;

  const embed = buildClaimEmbed({ typeLabel, attempt, chosenMention });
  const row = buildTicketRow();

  // Keep opener mention always visible in the ticket message content.
  const content = openerMention;

  // Update the ticket message so user sees claim attempt progressing.
  await editTicketMessage({ channel, ticket, embed, row, content });

  // Actually ping staff (edit mentions often don't notify) - ping-only message auto-deletes.
  await pingAndDelete({ channel, chosen });

  await scheduleNext({ guild, channel, settings, openerId, attempt, attemptedIds });
}

module.exports = { attemptClaim, clearTimer };
