/**
 * Core logic for ending a giveaway.
 * Called by the scheduler or manually.
 * Exported so it can be reused by reroll.
 */
const { getGiveaway, saveGiveaway } = require('../stores/giveawayStore');
const { clearEnd } = require('./giveawayTimer');
const { pickWinners, buildEndedEmbed, buildEntryButton } = require('./giveawayHelpers');

async function endGiveaway(client, messageId, channelId, guildId, { reroll = false } = {}) {
  const g = await getGiveaway(messageId);
  if (!g) return { error: 'Giveaway not found.' };

  // Pick winners
  const winners = pickWinners(g.entries, g.winnerCount);

  if (!reroll) {
    // Mark ended and persist
    g.ended = true;
    g.winners = winners;
    await saveGiveaway(g);
    clearEnd(messageId);
  } else {
    // Reroll — update winners in store
    g.winners = winners;
    await saveGiveaway(g);
  }

  // Edit the original message
  try {
    const channel = client.channels.cache.get(channelId) ||
      await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return { error: 'Channel not found.', winners };

    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) return { error: 'Message not found.', winners };

    const endedEmbed = buildEndedEmbed(g, winners);
    const disabledBtn = buildEntryButton(messageId, true);
    await message.edit({ embeds: [endedEmbed], components: [disabledBtn] });

    // Send winner announcement
    const winnerText = winners.length
      ? `🎊 Congratulations ${winners.map(id => `<@${id}>`).join(', ')}! You ${winners.length > 1 ? 'are' : 'is'} the winner${winners.length > 1 ? 's' : ''} of **${g.prize}**!`
      : `😔 No valid entries for **${g.prize}**. No winners this time.`;

    const label = reroll ? '🔁 Reroll Result' : '🎉 Giveaway Ended';
    await channel.send({
      content: `**${label}** | ${winnerText}\n> [Jump to giveaway](${message.url})`,
    });
  } catch (err) {
    console.error('[GIVEAWAY] Error ending giveaway:', err);
    return { error: err.message, winners };
  }

  return { winners, error: null };
}

module.exports = { endGiveaway };
