const { EmbedBuilder } = require('discord.js');

function formatDurationMs(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins) parts.push(`${mins}m`);
  if (secs || !parts.length) parts.push(`${secs}s`);
  return parts.join(' ');
}

function buildTicketReceiptEmbed({
  guildName,
  channelId,
  closerId,
  openerId,
  claimedBy,
  typeLabel,
  openedAt,
  closedAt,
}) {
  const openedUnix = Math.floor((openedAt || Date.now()) / 1000);
  const closedUnix = Math.floor((closedAt || Date.now()) / 1000);
  const durationText = formatDurationMs(Math.max(0, (closedAt || Date.now()) - (openedAt || Date.now())));

  return new EmbedBuilder()
    .setTitle('Ticket Receipt')
    .setDescription(`Your ticket in **${guildName}** has been completed.`)
    .addFields(
      { name: 'Ticket Channel', value: `<#${channelId}>`, inline: true },
      { name: 'Type', value: typeLabel || 'General', inline: true },
      { name: 'Opened By', value: `<@${openerId}>`, inline: true },
      { name: 'Closed By', value: `<@${closerId}>`, inline: true },
      { name: 'Claimed By', value: claimedBy ? `<@${claimedBy}>` : 'Not claimed', inline: true },
      { name: 'Opened At', value: `<t:${openedUnix}:F>`, inline: true },
      { name: 'Closed At', value: `<t:${closedUnix}:F>`, inline: true },
      { name: 'Duration', value: durationText, inline: true },
    )
    .setTimestamp(new Date(closedAt || Date.now()));
}

async function sendTicketReceiptDM({ client, openerId, embed }) {
  try {
    const user = await client.users.fetch(openerId);
    await user.send({ embeds: [embed] });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

module.exports = {
  buildTicketReceiptEmbed,
  sendTicketReceiptDM,
};
