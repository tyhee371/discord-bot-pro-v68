/**
 * withErrorHandler — unified error wrapper for command execute functions.
 *
 * Wraps a slash-command execute function so that:
 *   - AppError.publicMessage is surfaced to the user as an ephemeral reply.
 *   - Unknown errors surface a generic safe message and are forwarded to
 *     the error reporter / safe-mode tracker.
 *   - The interaction is always replied to (no silent "thinking" spinners).
 *
 * Usage:
 *   module.exports = {
 *     data: ...,
 *     execute: withErrorHandler('kick', async (interaction, client) => {
 *       // ... your command logic ...
 *     }),
 *   };
 *
 * For prefix handlers the pattern is simpler — just let exceptions bubble to
 * handlePrefixMessage which wraps its own try/catch.
 */

const { MessageFlags } = require('discord.js');
const { safeReply } = require('../utils/safeReply');
const { getPublicMessage } = require('./errors');
const { reportInteractionError, reportSafeModeDisabled } = require('../utils/errorReporter');
const { recordFailure } = require('../utils/safeMode');

/**
 * @param {string} commandName  — used for safe-mode tracking and error logs
 * @param {Function} fn         — async (interaction, client) => void
 * @returns {Function}          — wrapped execute function
 */
function withErrorHandler(commandName, fn) {
  return async function wrappedExecute(interaction, client) {
    try {
      await fn(interaction, client);
    } catch (err) {
      // ── Safe-mode tracking ───────────────────────────────────────────────
      const guildId = interaction?.guildId;
      if (guildId) {
        try {
          const safeRes = await recordFailure(guildId, 'slash', commandName);
          if (safeRes?.enabled && safeRes?.disabledNow && safeRes?.disabledUntil) {
            await reportSafeModeDisabled(interaction, 'slash', commandName, safeRes.disabledUntil, err);
          }
        } catch {
          // safe-mode failure must never mask the original error path
        }
      }

      // ── Error report ─────────────────────────────────────────────────────
      await reportInteractionError(interaction, err, commandName).catch(() => {});

      // ── User-facing reply ─────────────────────────────────────────────────
      const safeMessage = getPublicMessage(err);
      if (interaction?.isRepliable?.()) {
        if (interaction.deferred || interaction.replied) {
          await interaction
            .followUp({ content: safeMessage, flags: MessageFlags.Ephemeral })
            .catch(() => {});
        } else {
          await safeReply(interaction, { content: safeMessage, ephemeral: true }).catch(() => {});
        }
      }
    }
  };
}

module.exports = { withErrorHandler };
