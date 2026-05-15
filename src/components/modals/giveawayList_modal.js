/**
 * Modal handler for giveaway list actions: end / edit / delete
 * customId: giveawayList_modal:<action>
 */
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const { getGiveaway, saveGiveaway, deleteGiveaway, removeFromIndex } = require('../../utils/giveawayStore');
const { clearEnd } = require('../../utils/giveawayTimer');
const { endGiveaway } = require('../../utils/giveawayEnd');
const { buildActiveEmbed, buildEntryButton } = require('../../utils/giveawayHelpers');

// Guard: validate readSettings resolved correctly (spec 1.1)
if (typeof getGiveaway !== 'function') {
  throw new Error('[giveawayList_modal] getGiveaway is not defined - check giveawayStore.js exports');
}

module.exports = {
  id: 'giveawayList_modal',
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [, action] = interaction.customId.split(':');
    const messageId = interaction.fields.getTextInputValue('message_id')?.trim();

    if (!messageId) {
      return interaction.editReply('❌ Message ID cannot be empty.');
    }

    const g = await getGiveaway(messageId);
    if (!g) {
      return interaction.editReply(`❌ Giveaway \`${messageId}\` not found. Check the ID from \`/giveaway list\`.`);
    }

    // ── END (emergency) ──────────────────────────────────────────────────────
    if (action === 'end') {
      if (g.ended) {
        return interaction.editReply('❌ This giveaway has already ended.');
      }

      const result = await endGiveaway(
        interaction.client, messageId, g.channelId, interaction.guildId
      );

      if (result.error) {
        return interaction.editReply(`❌ Could not end giveaway: ${result.error}`);
      }

      const winnerText = result.winners.length
        ? result.winners.map(id => `<@${id}>`).join(', ')
        : 'No valid entries';

      return interaction.editReply(
        `✅ Giveaway **${g.prize}** ended immediately.\n🏆 Winner(s): ${winnerText}`
      );
    }

    // ── EDIT ─────────────────────────────────────────────────────────────────
    if (action === 'edit') {
      if (g.ended) {
        return interaction.editReply('❌ Cannot edit an ended giveaway.');
      }

      const prizeInput    = interaction.fields.getTextInputValue('prize')?.trim();
      const descInput     = interaction.fields.getTextInputValue('description')?.trim();
      const winnersInput  = interaction.fields.getTextInputValue('winners')?.trim();

      let changed = false;
      const changes = [];

      if (prizeInput) {
        g.prize = prizeInput.slice(0, 100);
        changes.push(`Prize → **${g.prize}**`);
        changed = true;
      }

      if (descInput !== undefined && descInput !== '') {
        g.description = descInput.slice(0, 500);
        changes.push('Description updated');
        changed = true;
      }

      if (winnersInput) {
        const wc = parseInt(winnersInput, 10);
        if (!Number.isInteger(wc) || wc < 1 || wc > 20) {
          return interaction.editReply('❌ Winner count must be a number between 1 and 20.');
        }
        g.winnerCount = wc;
        changes.push(`Winners → **${wc}**`);
        changed = true;
      }

      if (!changed) {
        return interaction.editReply('⚠️ No changes made — all fields were left blank.');
      }

      await saveGiveaway(g);

      // Update the live giveaway message embed
      try {
        const channel = interaction.guild.channels.cache.get(g.channelId) ||
          await interaction.guild.channels.fetch(g.channelId).catch(() => null);
        if (channel) {
          const msg = await channel.messages.fetch(messageId).catch(() => null);
          if (msg) {
            const updatedEmbed = buildActiveEmbed(g);
            const row = buildEntryButton(messageId);
            await msg.edit({ embeds: [updatedEmbed], components: [row] });
          }
        }
      } catch (err) {
        console.error('[GIVEAWAY] Could not update message after edit:', err);
      }

      return interaction.editReply(
        `✅ Giveaway **${g.prize}** updated:\n${changes.map(c => `• ${c}`).join('\n')}`
      );
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (action === 'delete') {
      // Cancel timer if still running
      clearEnd(messageId);

      // Delete from DB and index
      await deleteGiveaway(messageId);
      await removeFromIndex(interaction.guildId, messageId);

      // Try to delete or disable the original Discord message
      try {
        const channel = interaction.guild.channels.cache.get(g.channelId) ||
          await interaction.guild.channels.fetch(g.channelId).catch(() => null);
        if (channel) {
          const msg = await channel.messages.fetch(messageId).catch(() => null);
          if (msg) {
            // Delete if bot has ManageMessages, otherwise just disable the button
            const canDelete = channel.permissionsFor(interaction.guild.members.me)
              ?.has('ManageMessages');
            if (canDelete) {
              await msg.delete().catch(() => null);
            } else {
              const { buildEndedEmbed } = require('../../utils/giveawayHelpers');
              const cancelEmbed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle(`🚫 ${g.prize} — Giveaway Cancelled`)
                .setDescription('This giveaway was cancelled by a moderator.')
                .setTimestamp();
              const disabledBtn = buildEntryButton(messageId, true);
              await msg.edit({ embeds: [cancelEmbed], components: [disabledBtn] }).catch(() => null);
            }
          }
        }
      } catch (err) {
        console.error('[GIVEAWAY] Could not remove message after delete:', err);
      }

      return interaction.editReply(`🗑️ Giveaway **${g.prize}** has been deleted and removed.`);
    }

    return interaction.editReply('❌ Unknown action.');
  },
};
