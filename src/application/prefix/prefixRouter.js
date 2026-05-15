/**
 * Prefix Router — thin dispatcher.
 *
 * Responsibilities:
 *   1. Parse prefix + command name from the incoming message.
 *   2. Run guard pipeline (module enabled, cooldown).
 *   3. Delegate to the appropriate domain handler.
 *
 * All command logic lives in src/application/prefix/handlers/.
 * Guard config is derived from the shared command manifest.
 */

const { getGuildSettings } = require('../../utils/settings');
const { runPrefixGuards } = require('../../shared/guards/guardPipeline');
const { getCommandMeta } = require('../../shared/commandManifest');

const { actionAliases, handleFunAction } = require('./handlers/funHandler');
const { moderationCommands, handleModerationCommand } = require('./handlers/moderationHandler');
const { utilityCommands, handleUtilityCommand } = require('./handlers/utilityHandler');
const {
  musicDirectCommands,
  handleMusicCommand,
  handleMusicSubcommand,
} = require('./handlers/musicHandler');

function parseArgs(content) {
  return content.trim().split(/\s+/).filter(Boolean);
}

/**
 * Derive guard config for a command from the manifest.
 * Falls back to safe defaults if the command is not in the manifest.
 */
function getPrefixGuardConfig(cmd) {
  const meta = getCommandMeta(cmd);
  if (meta) {
    return {
      moduleKey: meta.category,
      cooldownSeconds: meta.cooldownSeconds ?? 2,
      ownerOnly: false,
    };
  }
  // Unknown command — treat as utility with a 1-second cooldown
  return { moduleKey: 'utility', cooldownSeconds: 1, ownerOnly: false };
}

async function handlePrefixMessage({ client, message }) {
  if (!message.guild || message.author.bot) return;

  const settings = await getGuildSettings(message.guild.id);
  const prefix = settings?.prefix ?? '!';
  if (!message.content.startsWith(prefix)) return;

  const args = parseArgs(message.content.slice(prefix.length));
  const cmd = (args.shift() || '').toLowerCase();
  if (!cmd) return;

  // ── Guard pipeline ─────────────────────────────────────────────────────────
  const guardMeta = getPrefixGuardConfig(cmd);
  const guard = await runPrefixGuards({ message, commandName: cmd, ...guardMeta });
  if (!guard.ok) return;

  // ── Fun actions ───────────────────────────────────────────────────────────
  if (actionAliases.has(cmd)) {
    await handleFunAction(message, cmd, args);
    return;
  }

  // ── Moderation ────────────────────────────────────────────────────────────
  if (moderationCommands.has(cmd)) {
    await handleModerationCommand(message, cmd, args, settings);
    return;
  }

  // ── Utility ───────────────────────────────────────────────────────────────
  if (utilityCommands.has(cmd)) {
    await handleUtilityCommand(message, cmd, args, prefix);
    return;
  }

  // ── Music (direct shortcuts: play, skip, queue, …) ────────────────────────
  if (musicDirectCommands.has(cmd)) {
    await handleMusicCommand(message, cmd, args, settings);
    return;
  }

  // ── Music (legacy `!music <subcommand>` form) ─────────────────────────────
  if (cmd === 'music') {
    await handleMusicSubcommand(message, args, prefix, settings);
    return;
  }
}

module.exports = {
  handlePrefixMessage,
  getPrefixGuardConfig,
};
