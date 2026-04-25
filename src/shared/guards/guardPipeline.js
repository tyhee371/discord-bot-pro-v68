const { MessageFlags } = require('discord.js');
const { isModuleEnabled } = require('../../utils/modules');
const { getSafeModeConfig, isTemporarilyDisabled } = require('../../utils/safeMode');
const { safeReply, safeDefer } = require('../../utils/safeReply');
const {
  createCooldownError,
  createModuleDisabledError,
  createSafeModeError,
  createPermissionError,
  getPublicMessage,
} = require('../errors');
const { CooldownStore } = require('../rateLimit');

const slashCooldowns = new CooldownStore();
const prefixCooldowns = new CooldownStore();

function safePrefixReply(message, options = {}) {
  if (!message || typeof message.reply !== 'function') return null;
  const payload = typeof options === 'string' ? { content: options } : options;
  return message.reply(payload).catch(() => null);
}

async function checkSafeMode({ guildId, kind, name, interaction, message }) {
  if (!guildId) return { ok: true };

  const cfg = await getSafeModeConfig(guildId).catch(() => null);
  if (!cfg?.enabled) return { ok: true };

  const dis = isTemporarilyDisabled(guildId, kind, name);
  if (!dis.disabled) return { ok: true };

  const err = createSafeModeError(kind, name, dis.disabledUntil);
  if (interaction) {
    await safeReply(interaction, { content: err.publicMessage, flags: MessageFlags.Ephemeral }).catch(() => {});
  } else if (message) {
    await safePrefixReply(message, { content: err.publicMessage, allowedMentions: { repliedUser: false } });
  }

  return { ok: false, error: err };
}

async function runInteractionGuards({ interaction, command, client }) {
  const commandName = command?._name || command?.data?.name || command?.name;
  const guildId = interaction?.guildId;

  const safeModeResult = await checkSafeMode({ guildId, kind: 'slash', name: commandName, interaction });
  if (!safeModeResult.ok) return safeModeResult;

  if (command.requiredPermissions?.length) {
    const missing = command.requiredPermissions.filter((p) => !interaction.memberPermissions?.has(p));
    if (missing.length) {
      const err = createPermissionError(`Missing permissions: ${missing.join(', ')}`);
      await safeReply(interaction, { content: err.publicMessage, flags: MessageFlags.Ephemeral }).catch(() => {});
      return { ok: false, error: err };
    }
  }

  if (command.ownerOnly) {
    const { ownerIds } = require('../../config');
    if (!ownerIds.includes(interaction.user.id)) {
      const err = createPermissionError('Owner-only command.');
      await safeReply(interaction, { content: err.publicMessage, flags: MessageFlags.Ephemeral }).catch(() => {});
      return { ok: false, error: err };
    }
  }

  const cooldownSeconds = command.cooldownSeconds ?? 0;
  const cooldown = slashCooldowns.isOnCooldown(commandName, interaction.user.id, cooldownSeconds);
  if (!cooldown.ok) {
    const err = createCooldownError(Math.ceil(cooldown.retryAfterMs / 1000));
    await safeReply(interaction, { content: err.publicMessage, flags: MessageFlags.Ephemeral }).catch(() => {});
    return { ok: false, error: err };
  }

  if (interaction.guildId && command.moduleKey) {
    const enabled = await isModuleEnabled(interaction.guildId, command.moduleKey).catch(() => true);
    if (!enabled) {
      const err = createModuleDisabledError(command.moduleKey);
      await safeReply(interaction, { content: err.publicMessage, flags: MessageFlags.Ephemeral }).catch(() => {});
      return { ok: false, error: err };
    }
  }

  return { ok: true };
}

async function runPrefixGuards({ message, commandName, moduleKey, cooldownSeconds, ownerOnly }) {
  const guildId = message?.guildId;
  const safeModeResult = await checkSafeMode({ guildId, kind: 'prefix', name: commandName, message });
  if (!safeModeResult.ok) return safeModeResult;

  if (ownerOnly) {
    const { ownerIds } = require('../../config');
    if (!ownerIds.includes(message.author.id)) {
      const err = createPermissionError('Owner-only command.');
      await safePrefixReply(message, { content: err.publicMessage, allowedMentions: { repliedUser: false } });
      return { ok: false, error: err };
    }
  }

  if (cooldownSeconds) {
    const cooldown = prefixCooldowns.isOnCooldown(commandName, message.author.id, cooldownSeconds);
    if (!cooldown.ok) {
      const err = createCooldownError(Math.ceil(cooldown.retryAfterMs / 1000));
      await safePrefixReply(message, { content: err.publicMessage, allowedMentions: { repliedUser: false } });
      return { ok: false, error: err };
    }
  }

  if (guildId && moduleKey) {
    const enabled = await isModuleEnabled(guildId, moduleKey).catch(() => true);
    if (!enabled) {
      const err = createModuleDisabledError(moduleKey);
      await safePrefixReply(message, { content: err.publicMessage, allowedMentions: { repliedUser: false } });
      return { ok: false, error: err };
    }
  }

  return { ok: true };
}

module.exports = {
  runInteractionGuards,
  runPrefixGuards,
  getPublicMessage,
  safePrefixReply,
};