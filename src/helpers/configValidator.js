/**
 * configValidator.js — guild configuration safety checker.
 *
 * Validates a guild's settings object against live Discord state
 * (channel existence, bot permissions, role existence) and returns
 * a list of structured warnings the operator can act on.
 *
 * Used by /doctor and the new /config validate command.
 *
 * Each result item:
 *   { level: 'error'|'warn'|'ok', area, message, fix? }
 */

const { ChannelType, PermissionFlagsBits } = require('discord.js');

const LEVELS = { error: 0, warn: 1, ok: 2 };

function result(level, area, message, fix = null) {
  return { level, area, message, fix };
}

// ── Channel helpers ───────────────────────────────────────────────────────────

async function resolveChannel(guild, channelId) {
  if (!channelId) return null;
  return guild.channels.cache.get(channelId)
    ?? (await guild.channels.fetch(channelId).catch(() => null));
}

function botCanSend(channel, me) {
  if (!channel || !me) return false;
  const perms = channel.permissionsFor(me);
  return perms?.has(PermissionFlagsBits.SendMessages) && perms?.has(PermissionFlagsBits.ViewChannel);
}

function botCanEmbed(channel, me) {
  if (!channel || !me) return false;
  return channel.permissionsFor(me)?.has(PermissionFlagsBits.EmbedLinks);
}

// ── Role helper ───────────────────────────────────────────────────────────────

async function resolveRole(guild, roleId) {
  if (!roleId) return null;
  return guild.roles.cache.get(roleId)
    ?? (await guild.roles.fetch(roleId).catch(() => null));
}

function botRoleHigherThan(guild, role, me) {
  if (!role || !me) return false;
  return (me.roles?.highest?.position ?? 0) > role.position;
}

// ── Validators ────────────────────────────────────────────────────────────────

async function validateModLogs(guild, settings, me, results) {
  const cfg = settings.modLogs ?? {};
  if (!cfg.enabled) {
    results.push(result('warn', 'Mod Logs', 'Mod logs are disabled. Moderation commands will require setup first.', 'Run `/modlogs setup` to configure.'));
    return;
  }
  const ch = await resolveChannel(guild, cfg.channelId);
  if (!ch) {
    results.push(result('error', 'Mod Logs', `Mod log channel \`${cfg.channelId}\` not found.`, 'Run `/modlogs setup` to reassign.'));
  } else if (!ch.isTextBased?.()) {
    results.push(result('error', 'Mod Logs', `Mod log channel #${ch.name} is not a text channel.`, 'Choose a text channel in `/modlogs setup`.'));
  } else if (!botCanSend(ch, me)) {
    results.push(result('error', 'Mod Logs', `Missing **Send Messages** or **View Channel** in #${ch.name}.`, `Grant bot access to #${ch.name}.`));
  } else if (!botCanEmbed(ch, me)) {
    results.push(result('warn', 'Mod Logs', `Missing **Embed Links** in #${ch.name}. Mod log embeds may fail.`, `Grant Embed Links to bot in #${ch.name}.`));
  } else {
    results.push(result('ok', 'Mod Logs', `Mod log channel #${ch.name} is reachable.`));
  }
}

async function validateTickets(guild, settings, me, results) {
  const cfg = settings.tickets ?? {};
  const builders = cfg.builders ?? {};
  const builderCount = Object.keys(builders).length;
  if (!builderCount) {
    results.push(result('warn', 'Tickets', 'No ticket panels configured.', 'Run `/ticket panel create` to set up a panel.'));
    return;
  }

  results.push(result('ok', 'Tickets', `${builderCount} ticket panel(s) configured.`));

  // Validate transcript channel if set
  if (cfg.transcriptChannelId) {
    const ch = await resolveChannel(guild, cfg.transcriptChannelId);
    if (!ch) {
      results.push(result('error', 'Tickets', `Transcript channel \`${cfg.transcriptChannelId}\` not found.`, 'Update transcript channel in `/ticket setup`.'));
    } else if (!botCanSend(ch, me)) {
      results.push(result('error', 'Tickets', `Bot cannot send to transcript channel #${ch.name}.`, `Grant bot Send Messages + View Channel in #${ch.name}.`));
    } else {
      results.push(result('ok', 'Tickets', `Transcript channel #${ch.name} is reachable.`));
    }
  }

  // Validate staff roles
  for (const roleKey of ['adminRoleId', 'modRoleId']) {
    const roleId = cfg[roleKey];
    if (roleId) {
      const role = await resolveRole(guild, roleId);
      if (!role) {
        results.push(result('error', 'Tickets', `${roleKey} role \`${roleId}\` not found.`, 'Update ticket roles in `/ticket setup`.'));
      } else {
        results.push(result('ok', 'Tickets', `Staff role @${role.name} exists.`));
      }
    }
  }
}

async function validateLogs(guild, settings, me, results) {
  const cfg = settings.logs ?? {};
  if (!cfg.enabled) {
    results.push(result('warn', 'Server Logs', 'Server logging is disabled.', 'Run `/logs setup` to configure.'));
    return;
  }
  const ch = await resolveChannel(guild, cfg.channelId);
  if (!ch) {
    results.push(result('error', 'Server Logs', `Log channel \`${cfg.channelId}\` not found.`, 'Run `/logs setup` to reassign.'));
  } else if (!botCanSend(ch, me)) {
    results.push(result('error', 'Server Logs', `Bot cannot send to log channel #${ch.name}.`, `Grant bot Send Messages + View Channel in #${ch.name}.`));
  } else {
    results.push(result('ok', 'Server Logs', `Log channel #${ch.name} is reachable.`));
  }
}

async function validateVerify(guild, settings, me, results) {
  const cfg = settings.verify ?? {};
  if (!cfg.enabled) return; // optional feature — no warning if disabled

  const ch = await resolveChannel(guild, cfg.channelId);
  if (!ch) {
    results.push(result('error', 'Verification', `Verify channel \`${cfg.channelId}\` not found.`));
  } else if (!botCanSend(ch, me)) {
    results.push(result('error', 'Verification', `Bot cannot send to verify channel #${ch.name}.`));
  } else {
    results.push(result('ok', 'Verification', `Verify channel #${ch.name} is reachable.`));
  }

  const role = await resolveRole(guild, cfg.roleId);
  if (!role) {
    results.push(result('error', 'Verification', `Verify role \`${cfg.roleId}\` not found.`));
  } else if (!botRoleHigherThan(guild, role, guild.members.me)) {
    results.push(result('error', 'Verification', `Bot's role is below @${role.name}. Cannot assign verify role.`, 'Move the bot role above the verify role in Server Settings > Roles.'));
  } else {
    results.push(result('ok', 'Verification', `Verify role @${role.name} exists and is assignable.`));
  }
}

async function validateModeration(guild, settings, me, results) {
  const prison = settings.moderation?.prison ?? {};
  if (!prison.enabled) return;

  const role = await resolveRole(guild, prison.roleId);
  if (!role) {
    results.push(result('error', 'Moderation', `Prison role \`${prison.roleId}\` not found.`));
  } else if (!botRoleHigherThan(guild, role, guild.members.me)) {
    results.push(result('error', 'Moderation', `Bot role is below prison role @${role.name}.`, 'Move bot role above the prison role.'));
  } else {
    results.push(result('ok', 'Moderation', `Prison role @${role.name} is valid and assignable.`));
  }

  if (prison.jailChannelId) {
    const ch = await resolveChannel(guild, prison.jailChannelId);
    if (!ch) {
      results.push(result('error', 'Moderation', `Jail channel \`${prison.jailChannelId}\` not found.`));
    } else {
      results.push(result('ok', 'Moderation', `Jail channel #${ch.name} exists.`));
    }
  }
}

async function validateStarboard(guild, settings, me, results) {
  const sb = settings.starboard ?? {};
  if (!sb.enabled) return;

  const ch = await resolveChannel(guild, sb.channelId);
  if (!ch) {
    results.push(result('error', 'Starboard', `Starboard channel \`${sb.channelId}\` not found.`, 'Run `/starboard setup` to reassign.'));
  } else if (!botCanSend(ch, me) || !ch.permissionsFor(me)?.has(PermissionFlagsBits.EmbedLinks)) {
    results.push(result('error', 'Starboard', `Bot lacks Send Messages or Embed Links in #${ch.name}.`));
  } else {
    results.push(result('ok', 'Starboard', `Starboard channel #${ch.name} is reachable.`));
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run all config validators for a guild.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} settings  Result of getGuildSettings(guildId)
 * @returns {Promise<Array<{level: string, area: string, message: string, fix: string|null}>>}
 */
async function validateConfig(guild, settings) {
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  const results = [];

  await Promise.all([
    validateModLogs(guild, settings, me, results),
    validateTickets(guild, settings, me, results),
    validateLogs(guild, settings, me, results),
    validateVerify(guild, settings, me, results),
    validateModeration(guild, settings, me, results),
    validateStarboard(guild, settings, me, results),
  ]);

  // Sort: errors first, then warnings, then ok
  results.sort((a, b) => LEVELS[a.level] - LEVELS[b.level]);
  return results;
}

/**
 * Format validation results as Discord embed fields.
 * @param {Array} results
 * @returns {{ fields: Array, summary: string }}
 */
function formatValidationResults(results) {
  const icons = { error: '🔴', warn: '🟡', ok: '🟢' };
  const errorCount = results.filter((r) => r.level === 'error').length;
  const warnCount = results.filter((r) => r.level === 'warn').length;

  const fields = results.map((r) => ({
    name: `${icons[r.level]} [${r.area}] ${r.message}`,
    value: r.fix ? `> 💡 ${r.fix}` : '> No action needed.',
    inline: false,
  }));

  const summary =
    errorCount > 0
      ? `❌ **${errorCount} error(s)** and ${warnCount} warning(s) found.`
      : warnCount > 0
        ? `⚠️ **${warnCount} warning(s)** found.`
        : '✅ All config checks passed.';

  return { fields, summary };
}

module.exports = { validateConfig, formatValidationResults };
