/**
 * Button handler for giveaway entries pagination.
 * customId: giveawayEntries:<giveawayId>:<page>
 *
 * Edits the existing entries embed in-place to show the requested page.
 * The embed is ephemeral (sent as editReply) so only the user who clicked
 * the list button sees it — no channel spam.
 */
'use strict';

const { MessageFlags } = require('discord.js');
const { getGiveaway } = require('../../utils/giveawayStore');
const { buildEntriesEmbed, buildEntriesRow } = require('../../services/giveawayHelpers');

module.exports = {
  id: 'giveawayEntries',

  async execute(interaction) {
    // customId: giveawayEntries:<giveawayId>:<page>
    const parts      = interaction.customId.split(':');
    const giveawayId = parts[1];
    const page       = parseInt(parts[2], 10);

    if (!giveawayId || isNaN(page)) {
      return interaction.reply({
        content: '❌ Invalid entries button.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Defer update — edits the existing message in place
    await interaction.deferUpdate();

    const g = await getGiveaway(giveawayId);
    if (!g) {
      return interaction.followUp({
        content: '❌ Giveaway not found — it may have been deleted.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const total = g.entries.length;
    if (total === 0) {
      return interaction.followUp({
        content: `📭 **${g.prize}** has no entries.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const pages    = Math.ceil(total / 10);
    const safePage = Math.max(0, Math.min(page, pages - 1));

    const embed = buildEntriesEmbed(g, safePage);
    const row   = buildEntriesRow(g.id, safePage, total);

    // Edit the original ephemeral reply in place
    await interaction.editReply({ embeds: [embed], components: [row] });
  },
};
