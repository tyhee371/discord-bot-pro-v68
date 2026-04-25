/**
 * Button handler for giveaway entry.
 * customId: giveaway_enter:<messageId>
 */
const { getGiveaway, saveGiveaway } = require('../../utils/giveawayStore');
const { buildActiveEmbed } = require('../../utils/giveawayHelpers');
const { MessageFlags } = require('discord.js');

module.exports = {
  id: 'giveaway_enter',
  async execute(interaction) {
    // customId: giveaway_enter:<messageId>
    const messageId = interaction.customId.split(':')[1];

    if (!messageId) {
      return interaction.reply({
        content: '❌ Invalid giveaway button.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const g = await getGiveaway(messageId);

    // Giveaway not found
    if (!g) {
      return interaction.reply({
        content: '❌ This giveaway no longer exists.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Giveaway already ended
    if (g.ended) {
      return interaction.reply({
        content: '❌ This giveaway has already ended.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Giveaway expired but not yet processed
    if (g.endTime <= Date.now()) {
      return interaction.reply({
        content: '❌ This giveaway has expired.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const userId = interaction.user.id;

    // CASE 1: Already entered — do NOT remove (spec requirement)
    if (g.entries.includes(userId)) {
      return interaction.reply({
        content: '❌ You have already entered this giveaway.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // CASE 2: Role check
    if (g.requiredRoleId) {
      const member = interaction.member ||
        await interaction.guild.members.fetch(userId).catch(() => null);

      if (!member) {
        return interaction.reply({
          content: '❌ Could not verify your roles. Please try again.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const hasRole = member.roles?.cache?.has(g.requiredRoleId) ??
        member.roles?.includes?.(g.requiredRoleId) ??
        false;

      if (!hasRole) {
        return interaction.reply({
          content: `❌ You do not have the required role to enter this giveaway.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    // CASE 3: Valid entry — add user
    g.entries.push(userId);
    await saveGiveaway(g);

    // Update the embed entry count live
    try {
      const embed = buildActiveEmbed(g);
      await interaction.message.edit({ embeds: [embed] });
    } catch {
      // Non-fatal — entry is saved, just couldn't update count display
    }

    return interaction.reply({
      content: '✅ You have successfully entered the giveaway! Good luck! 🎉',
      flags: MessageFlags.Ephemeral,
    });
  },
};
