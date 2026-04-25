const { Events, MessageFlags } = require('discord.js');
const { logger } = require('../utils/logger');
const { safeReply, safeDefer } = require('../utils/safeReply');
const { isModuleEnabled } = require('../utils/modules');
const { getSafeModeConfig, isTemporarilyDisabled, recordFailure } = require('../utils/safeMode');
const { reportInteractionError, reportSafeModeDisabled } = require('../utils/errorReporter');
const { handleInteraction } = require('../application/handlers/commandHandler');

const cooldowns = new Map(); // commandName -> Map(userId -> timestampMs)

function isOnCooldown(command, userId) {
  const cooldownSeconds = command.cooldownSeconds ?? 0;
  if (!cooldownSeconds) return { ok: true };

  if (!cooldowns.has(command.data.name)) cooldowns.set(command.data.name, new Map());
  const users = cooldowns.get(command.data.name);

  const now = Date.now();
  const expiresAt = (users.get(userId) ?? 0) + cooldownSeconds * 1000;

  if (now < expiresAt) return { ok: false, retryAfterMs: expiresAt - now };

  users.set(userId, now);
  return { ok: true };
}



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

module.exports = {
  name: Events.InteractionCreate,
  async execute(client, interaction) {
    try {
      // --------------------
      // Slash Commands
      // --------------------
      if (interaction.isChatInputCommand()) {
        await handleInteraction(client, interaction);
        return;
      }

      // --------------------
      // Buttons
      // --------------------
      if (interaction.isButton()) {
        const fullId = interaction.customId;
        let handler = client.components.buttons.get(fullId);
        const parts = String(fullId).split(':');
        const baseId2 = parts.length >= 2 ? `${parts[0]}:${parts[1]}` : parts[0];
        const baseId1 = parts[0];
        if (!handler) handler = client.components.buttons.get(baseId2);
        if (!handler) handler = client.components.buttons.get(baseId1);
        if (!handler) handler = client.components.buttons.get(String(fullId).toLowerCase());
        if (!handler) handler = client.components.buttons.get(String(baseId2).toLowerCase());
        if (!handler) handler = client.components.buttons.get(String(baseId1).toLowerCase());

        if (!handler) {
          return safeReply(interaction, {
            content: 'Unknown/expired button.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const guard = await guardSafeMode(interaction, 'button', baseId2);
        if (guard.blocked) return;

        await handler.execute(interaction, client);
        return;
      }

      // --------------------
      // Select Menus
      // --------------------
      if (interaction.isStringSelectMenu()) {
        const fullId = interaction.customId;
        let handler = client.components.selects.get(fullId);
        const parts = String(fullId).split(':');
        const baseId2 = parts.length >= 2 ? `${parts[0]}:${parts[1]}` : parts[0];
        const baseId1 = parts[0];
        if (!handler) handler = client.components.selects.get(baseId2);
        if (!handler) handler = client.components.selects.get(baseId1);
        if (!handler) handler = client.components.selects.get(String(fullId).toLowerCase());
        if (!handler) handler = client.components.selects.get(String(baseId2).toLowerCase());
        if (!handler) handler = client.components.selects.get(String(baseId1).toLowerCase());

        if (!handler) {
          return safeReply(interaction, {
            content: 'Unknown/expired menu.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const guard = await guardSafeMode(interaction, 'select', baseId2);
        if (guard.blocked) return;

        await handler.execute(interaction, client);
        return;
      }

      // --------------------
      // Channel Select Menus
      // --------------------
      if (interaction.isChannelSelectMenu()) {
        const fullId = interaction.customId;
        let handler = client.components.selects.get(fullId);
        const baseId = fullId.split(':')[0];
        if (!handler) handler = client.components.selects.get(baseId);
        if (!handler) handler = client.components.selects.get(String(fullId).toLowerCase());
        if (!handler) handler = client.components.selects.get(String(baseId).toLowerCase());

        if (!handler) {
          return safeReply(interaction, {
            content: 'Unknown/expired menu.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const guard = await guardSafeMode(interaction, 'select', fullId.split(':')[0]);
        if (guard.blocked) return;

        await handler.execute(interaction, client);
        return;
      }

      // --------------------
      // Modals
      // --------------------
      if (interaction.isModalSubmit()) {
        const fullId = interaction.customId;
        let handler = client.components.modals.get(fullId);
        const parts = String(fullId).split(':');
        const baseId2 = parts.length >= 2 ? `${parts[0]}:${parts[1]}` : parts[0];
        const baseId1 = parts[0];
        if (!handler) handler = client.components.modals.get(baseId2);
        if (!handler) handler = client.components.modals.get(baseId1);
        if (!handler) handler = client.components.modals.get(String(fullId).toLowerCase());
        if (!handler) handler = client.components.modals.get(String(baseId2).toLowerCase());
        if (!handler) handler = client.components.modals.get(String(baseId1).toLowerCase());
        if (!handler) return;

        const guard = await guardSafeMode(interaction, 'modal', baseId2);
        if (guard.blocked) return;

        await handler.execute(interaction, client);
        return;
      }
    } catch (error) {
      logger.error({ err: error, type: 'interaction', id: interaction?.id, userId: interaction?.user?.id, guildId: interaction?.guildId, command: interaction?.commandName, customId: interaction?.customId }, 'Interaction error');
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


      console.error('[ERROR]', error);

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