const { Events, MessageFlags } = require('discord.js');
const { metrics } = require('../utils/metrics');
const { logger } = require('../utils/logger');
const { safeReply } = require('../utils/safeReply');
const { isModuleEnabled } = require('../utils/modules');
const { getSafeModeConfig, isTemporarilyDisabled, recordFailure } = require('../utils/safeMode');
const { reportInteractionError, reportSafeModeDisabled } = require('../utils/errorReporter');
const { handleInteraction } = require('../application/handlers/commandHandler');

// Cooldown enforcement is handled by guardPipeline.js (src/shared/guards/guardPipeline.js)
// using the Redis-backed CooldownStore. The local cooldowns Map that used to live here
// was dead code — isOnCooldown() was defined but never called in this file.

async function guardSafeMode(interaction, kind, name) {
  const guildId = interaction.guildId;
  if (!guildId) return { blocked: false };

  const cfg = await getSafeModeConfig(guildId).catch(() => null);
  if (!cfg?.enabled) return { blocked: false };

  const dis = isTemporarilyDisabled(guildId, kind, name);
  if (!dis.disabled) return { blocked: false };

  await safeReply(interaction, {
    content: `🛡️ This ${kind} is temporarily disabled due to errors. Try again ${dis.disabledUntil ? `<t:${Math.floor(dis.disabledUntil / 1000)}:R>` : 'later'}.`,
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
  return { blocked: true };
}

/**
 * Resolves a component handler from a Collection using the standard
 * fallback chain: fullId → two-part base → one-part base → lowercased variants.
 * Extracted to eliminate the 60-line copy-paste across buttons/selects/modals.
 *
 * @param {import('discord.js').Collection} collection
 * @param {string} customId
 * @returns {{ handler: object|null, baseId: string }}
 */
function resolveComponentHandler(collection, customId) {
  const parts = String(customId).split(':');
  const baseId2 = parts.length >= 2 ? `${parts[0]}:${parts[1]}` : parts[0];
  const baseId1 = parts[0];

  const handler =
    collection.get(customId) ??
    collection.get(baseId2) ??
    collection.get(baseId1) ??
    collection.get(customId.toLowerCase()) ??
    collection.get(baseId2.toLowerCase()) ??
    collection.get(baseId1.toLowerCase()) ??
    null;

  return { handler, baseId: baseId2 };
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(client, interaction) {
    try {
      // ── Slash Commands ──────────────────────────────────────────────────────
      if (interaction.isChatInputCommand()) {
        await handleInteraction(client, interaction);
        return;
      }

      // ── Buttons ─────────────────────────────────────────────────────────────
      if (interaction.isButton()) {
        const { handler, baseId } = resolveComponentHandler(
          client.components.buttons,
          interaction.customId,
        );
        if (!handler) {
          return safeReply(interaction, {
            content: 'Unknown/expired button.',
            flags: MessageFlags.Ephemeral,
          });
        }
        const guard = await guardSafeMode(interaction, 'button', baseId);
        if (guard.blocked) return;
        await handler.execute(interaction, client);
        return;
      }

      // ── String Select Menus ─────────────────────────────────────────────────
      if (interaction.isStringSelectMenu()) {
        const { handler, baseId } = resolveComponentHandler(
          client.components.selects,
          interaction.customId,
        );
        if (!handler) {
          return safeReply(interaction, {
            content: 'Unknown/expired menu.',
            flags: MessageFlags.Ephemeral,
          });
        }
        const guard = await guardSafeMode(interaction, 'select', baseId);
        if (guard.blocked) return;
        await handler.execute(interaction, client);
        return;
      }

      // ── Channel Select Menus ────────────────────────────────────────────────
      if (interaction.isChannelSelectMenu()) {
        const { handler, baseId } = resolveComponentHandler(
          client.components.selects,
          interaction.customId,
        );
        if (!handler) {
          return safeReply(interaction, {
            content: 'Unknown/expired menu.',
            flags: MessageFlags.Ephemeral,
          });
        }
        const guard = await guardSafeMode(interaction, 'select', baseId);
        if (guard.blocked) return;
        await handler.execute(interaction, client);
        return;
      }

      // ── Modals ──────────────────────────────────────────────────────────────
      if (interaction.isModalSubmit()) {
        const { handler, baseId } = resolveComponentHandler(
          client.components.modals,
          interaction.customId,
        );
        if (!handler) return; // silently ignore unknown modals
        const guard = await guardSafeMode(interaction, 'modal', baseId);
        if (guard.blocked) return;
        await handler.execute(interaction, client);
        return;
      }
    } catch (error) {
      logger.error(
        {
          err: error,
          type: 'interaction',
          id: interaction?.id,
          userId: interaction?.user?.id,
          guildId: interaction?.guildId,
          command: interaction?.commandName,
          customId: interaction?.customId,
        },
        'Interaction error',
      );

      if (interaction?.isChatInputCommand?.()) {
        await reportInteractionError(interaction, error, interaction.commandName);
      }

      // Safe mode: auto-disable repeatedly failing handlers
      try {
        const guildId = interaction?.guildId;
        if (guildId) {
          let kind = null;
          let name = null;
          if (interaction?.isChatInputCommand?.()) {
            kind = 'slash';
            name = interaction.commandName;
          } else if (interaction?.isButton?.()) {
            kind = 'button';
            name = String(interaction.customId || '').split(':')[0];
          } else if (interaction?.isStringSelectMenu?.() || interaction?.isChannelSelectMenu?.()) {
            kind = 'select';
            name = String(interaction.customId || '').split(':')[0];
          } else if (interaction?.isModalSubmit?.()) {
            kind = 'modal';
            name = String(interaction.customId || '').split(':')[0];
          }

          if (kind && name) {
            const res = await recordFailure(guildId, kind, name);
            if (res.enabled && res.disabledNow && res.disabledUntil) {
              await reportSafeModeDisabled(interaction, kind, name, res.disabledUntil, error);
            }
          }
        }
      } catch (_) {
        // ignore safe mode errors
      }

      const msg = '❌ An error occurred while executing this interaction.';
      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
        } else {
          await safeReply(interaction, { content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      }
    }
  },
};
