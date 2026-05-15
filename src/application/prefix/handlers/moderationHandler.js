/**
 * Moderation command handler (prefix)
 * Handles: kick, ban, timeout, warn, clear
 */

const { PermissionsBitField } = require('discord.js');
const { getGuildSettings } = require('../../../utils/settings');
const { parseDuration, formatDuration } = require('../../../utils/duration');
const { addWarn, listWarns } = require('../../../services/moderationService');
const { db } = require('../../../db');
const { getModLogConfig, resolveModLogChannel, createAndSendCase } = require('../../../utils/modLogService');

const moderationCommands = new Set(['kick', 'ban', 'timeout', 'warn', 'clear']);

function extractId(token) {
  if (!token) return null;
  const m = String(token).match(/^<@!?(\d{15,20})>$/) || String(token).match(/^(\d{15,20})$/);
  return m ? m[1] : null;
}

function pickWarnLevel(levels, count) {
  if (!Array.isArray(levels)) return null;
  const clean = levels
    .map((l) => ({ threshold: Number(l.threshold), durationMs: Number(l.durationMs) }))
    .filter((l) => Number.isFinite(l.threshold) && l.threshold > 0 && Number.isFinite(l.durationMs) && l.durationMs > 0)
    .sort((a, b) => a.threshold - b.threshold);
  let chosen = null;
  for (const l of clean) if (count >= l.threshold) chosen = l;
  return chosen;
}

function appliedLevelKey(guildId, userId) {
  return `warnLevelApplied:${guildId}:${userId}`;
}

async function requireModLogForMessage(message) {
  const cfg = await getModLogConfig(message.guild.id);
  if (!cfg.enabled || !cfg.channelId) {
    await message.reply('❌ **Mod logs channel is not configured.** Use `/modlogs setup` first.').catch(() => {});
    return null;
  }
  const ch = await resolveModLogChannel(message.guild, cfg.channelId);
  if (!ch) {
    await message.reply('❌ Mod logs channel is invalid/missing. Please run `/modlogs setup` again.').catch(() => {});
    return null;
  }
  return ch;
}

async function handleModerationCommand(message, cmd, args, settings) {
  const modLogCh = await requireModLogForMessage(message);
  if (!modLogCh) return true;

  const me = await message.guild.members.fetchMe().catch(() => null);
  const authorMember = message.member;

  if (cmd === 'kick') {
    if (!authorMember.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      await message.reply('❌ Missing permission: Kick Members').catch(() => {});
      return true;
    }

    const targetId = extractId(args.shift());
    if (!targetId) {
      await message.reply(`Usage: \`${settings.prefix ?? '!'}kick @user [reason]\``).catch(() => {});
      return true;
    }

    const user = await message.client.users.fetch(targetId).catch(() => null);
    const member = await message.guild.members.fetch(targetId).catch(() => null);
    if (!user || !member) {
      await message.reply('That user is not in this server.').catch(() => {});
      return true;
    }

    if (user.id === message.author.id) {
      await message.reply("You can't kick yourself.").catch(() => {});
      return true;
    }

    if (!member.kickable) {
      await message.reply('❌ I cannot kick that member (role hierarchy / missing perms).').catch(() => {});
      return true;
    }

    if (authorMember?.roles?.highest && member.roles.highest.position >= authorMember.roles.highest.position) {
      await message.reply('❌ You cannot kick someone with an equal/higher role than you.').catch(() => {});
      return true;
    }

    if (me && me.roles.highest.position <= member.roles.highest.position) {
      await message.reply('❌ My role must be higher than the target\'s highest role.').catch(() => {});
      return true;
    }

    const reason = args.join(' ').trim() || 'None';
    await member.kick(reason).catch(() => null);
    const c = await createAndSendCase({
      guild: message.guild,
      type: 'kick',
      title: '🥾 Kick',
      moderator: message.author,
      target: user,
      reason,
      dmTarget: true,
    });

    await message.reply(`✅ Kicked **${user.tag}**. Reason: ${reason}${c ? ` | Case: #${c.id}` : ''}`).catch(() => {});
    return true;
  }

  if (cmd === 'ban') {
    if (!authorMember.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      await message.reply('❌ Missing permission: Ban Members').catch(() => {});
      return true;
    }

    const targetId = extractId(args.shift());
    if (!targetId) {
      await message.reply(`Usage: \`${settings.prefix ?? '!'}ban @user [reason]\``).catch(() => {});
      return true;
    }

    const user = await message.client.users.fetch(targetId).catch(() => null);
    const member = await message.guild.members.fetch(targetId).catch(() => null);
    if (!user || !member) {
      await message.reply('That user is not in this server.').catch(() => {});
      return true;
    }

    if (user.id === message.author.id) {
      await message.reply("You can't ban yourself.").catch(() => {});
      return true;
    }

    if (!member.bannable) {
      await message.reply('❌ I cannot ban that member (role hierarchy / missing perms).').catch(() => {});
      return true;
    }

    if (authorMember?.roles?.highest && member.roles.highest.position >= authorMember.roles.highest.position) {
      await message.reply('❌ You cannot ban someone with an equal/higher role than you.').catch(() => {});
      return true;
    }

    if (me && me.roles.highest.position <= member.roles.highest.position) {
      await message.reply('❌ My role must be higher than the target\'s highest role.').catch(() => {});
      return true;
    }

    const reason = args.join(' ').trim() || 'None';
    await member.ban({ reason }).catch(() => null);
    const c = await createAndSendCase({
      guild: message.guild,
      type: 'ban',
      title: '🔨 Ban',
      moderator: message.author,
      target: user,
      reason,
      dmTarget: true,
    });

    await message.reply(`✅ Banned **${user.tag}**. Reason: ${reason}${c ? ` | Case: #${c.id}` : ''}`).catch(() => {});
    return true;
  }

  if (cmd === 'timeout') {
    if (!authorMember.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      await message.reply('❌ Missing permission: Moderate Members').catch(() => {});
      return true;
    }

    const targetId = extractId(args.shift());
    const durRaw = (args.shift() || '').trim();
    if (!targetId || !durRaw) {
      await message.reply(`Usage: \`${settings.prefix ?? '!'}timeout @user <duration> [reason]\``).catch(() => {});
      return true;
    }

    const user = await message.client.users.fetch(targetId).catch(() => null);
    const member = await message.guild.members.fetch(targetId).catch(() => null);
    if (!user || !member) {
      await message.reply('That user is not in this server.').catch(() => {});
      return true;
    }

    if (user.id === message.author.id) {
      await message.reply('❌ You cannot timeout yourself.').catch(() => {});
      return true;
    }

    const durationMs = parseDuration(durRaw);
    if (!durationMs) {
      await message.reply('❌ Invalid duration. Use formats like 30s, 5m, 2h, 1d.').catch(() => {});
      return true;
    }

    const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
    if (durationMs > MAX_TIMEOUT_MS) {
      await message.reply('❌ Duration too long. Max timeout is 28 days.').catch(() => {});
      return true;
    }

    if (authorMember?.roles?.highest && member.roles.highest.position >= authorMember.roles.highest.position) {
      await message.reply('❌ You cannot timeout someone with an equal/higher role than you.').catch(() => {});
      return true;
    }

    if (me && me.roles.highest.position <= member.roles.highest.position) {
      await message.reply('❌ My role must be higher than the target\'s highest role.').catch(() => {});
      return true;
    }

    const reason = args.join(' ').trim() || 'None';
    const ok = await member.timeout(durationMs, reason).then(() => true).catch(() => false);
    if (!ok) {
      await message.reply('⚠️ I could not apply the timeout (missing perms / hierarchy).').catch(() => {});
      return true;
    }

    const c = await createAndSendCase({
      guild: message.guild,
      type: 'timeout',
      title: '⏳ Timeout',
      moderator: message.author,
      target: user,
      reason,
      fields: [{ name: 'Duration', value: formatDuration(durationMs), inline: true }],
      durationMs,
      dmTarget: true,
    });

    await message.reply(`⏳ Timed out **${user.tag}** for **${formatDuration(durationMs)}**. Reason: ${reason}${c ? ` | Case: #${c.id}` : ''}`).catch(() => {});
    return true;
  }

  if (cmd === 'warn') {
    if (!authorMember.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      await message.reply('❌ Missing permission: Moderate Members').catch(() => {});
      return true;
    }

    const targetId = extractId(args.shift());
    if (!targetId) {
      await message.reply(`Usage: \`${settings.prefix ?? '!'}warn @user [reason]\``).catch(() => {});
      return true;
    }

    const user = await message.client.users.fetch(targetId).catch(() => null);
    if (!user) {
      await message.reply('❌ Invalid user.').catch(() => {});
      return true;
    }

    const reason = args.join(' ').trim() || 'None';
    const w = await addWarn(message.guild.id, user.id, message.author.id, reason);
    const warnsNow = await listWarns(message.guild.id, user.id);
    const count = warnsNow.length;

    const warnCase = await createAndSendCase({
      guild: message.guild,
      type: 'warn',
      title: '⚠️ Warn Added',
      moderator: message.author,
      target: user,
      reason,
      fields: [
        { name: 'Warn ID', value: `\`${w.id}\``, inline: true },
        { name: 'Total Warns', value: String(count), inline: true },
      ],
      dmTarget: false,
      extra: { warnId: w.id, totalWarns: count },
    });

    const s = await getGuildSettings(message.guild.id);
    const levels = s.moderation?.warnLevels ?? [];
    const chosen = pickWarnLevel(levels, count);
    const wa = s.moderation?.warnAutoTimeout ?? { enabled: true, threshold: 15, durationMs: 5 * 60 * 1000 };
    let autoTimeoutNote = '';

    if (chosen) {
      const lastApplied = (await db.get(appliedLevelKey(message.guild.id, user.id))) ?? 0;
      if (chosen.threshold > Number(lastApplied)) {
        const safeDuration = Math.min(chosen.durationMs, 28 * 24 * 60 * 60 * 1000);
        const member = await message.guild.members.fetch(user.id).catch(() => null);
        if (member) {
          const autoReason = `Auto-timeout: reached warn level ${chosen.threshold} (now ${count}). Latest: ${reason}`;
          const ok = await member.timeout(safeDuration, autoReason).then(() => true).catch(() => false);
          if (ok) {
            await db.set(appliedLevelKey(message.guild.id, user.id), chosen.threshold);
            autoTimeoutNote = `\n⏳ Auto-timeout applied for **${formatDuration(safeDuration)}** (level: ${chosen.threshold} warns).`;
            await createAndSendCase({
              guild: message.guild,
              type: 'timeout',
              title: '⏳ Auto Timeout (Warn Level)',
              moderator: message.author,
              target: user,
              reason: autoReason,
              fields: [
                { name: 'Duration', value: formatDuration(safeDuration), inline: true },
                { name: 'Warns', value: `${count} (level ${chosen.threshold})`, inline: true },
              ],
              durationMs: safeDuration,
              dmTarget: true,
              extra: { source: 'warnLevel', warnCount: count, threshold: chosen.threshold },
            });
          } else {
            autoTimeoutNote = `\n⚠️ Reached warn level (**${chosen.threshold}**), but I couldn't apply the timeout (missing perms / hierarchy).`;
          }
        } else {
          autoTimeoutNote = `\n⚠️ Reached warn level (**${chosen.threshold}**), but user is not in this server (no timeout applied).`;
        }
      }
    }

    if (!chosen && wa.enabled && Number.isFinite(wa.threshold) && count >= wa.threshold) {
      const safeDuration = Math.min(wa.durationMs ?? 5 * 60 * 1000, 28 * 24 * 60 * 60 * 1000);
      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (member) {
        const autoReason = `Auto-timeout: reached ${count}/${wa.threshold} warnings. Latest: ${reason}`;
        const ok = await member.timeout(safeDuration, autoReason).then(() => true).catch(() => false);
        if (ok) {
          autoTimeoutNote = `\n⏳ Auto-timeout applied for **${formatDuration(safeDuration)}** (threshold: ${wa.threshold}).`;
          await createAndSendCase({
            guild: message.guild,
            type: 'timeout',
            title: '⏳ Auto Timeout (Warn Threshold)',
            moderator: message.author,
            target: user,
            reason: autoReason,
            fields: [
              { name: 'Duration', value: formatDuration(safeDuration), inline: true },
              { name: 'Warns', value: `${count}/${wa.threshold}`, inline: true },
            ],
            durationMs: safeDuration,
            dmTarget: true,
            extra: { source: 'warnThreshold', warnCount: count, threshold: wa.threshold },
          });
        } else {
          autoTimeoutNote = `\n⚠️ Reached threshold (**${wa.threshold}**), but I couldn't apply the timeout (missing perms / hierarchy).`;
        }
      } else {
        autoTimeoutNote = `\n⚠️ Reached threshold (**${wa.threshold}**), but user is not in this server (no timeout applied).`;
      }
    }

    await message.reply(`⚠️ Warned **${user.tag}**. WarnID: \`${w.id}\`\nTotal warns: **${count}**. Reason: **${reason}**` + (warnCase ? ` Case: **#${warnCase.id}**.` : '') + autoTimeoutNote).catch(() => {});
    return true;
  }

  if (cmd === 'clear') {
    if (!authorMember.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      await message.reply('❌ Missing permission: Manage Messages').catch(() => {});
      return true;
    }

    const amountRaw = (args.shift() || '').trim();
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100) {
      await message.reply(`Usage: \`${settings.prefix ?? '!'}clear <1-100> [reason]\``).catch(() => {});
      return true;
    }

    const reason = args.join(' ').trim() || 'None';
    const deleted = await message.channel.bulkDelete(amount, true).catch(() => null);
    const deletedCount = deleted?.size ?? 0;

    const c = await createAndSendCase({
      guild: message.guild,
      type: 'clear',
      title: '🧽 Clear Messages',
      moderator: message.author,
      target: null,
      reason,
      fields: [
        { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
        { name: 'Requested', value: String(amount), inline: true },
        { name: 'Deleted', value: String(deletedCount), inline: true },
      ],
      dmTarget: false,
      extra: { channelId: message.channel.id, requested: amount, deleted: deletedCount },
    });

    await message.reply(`🧽 Cleared **${deletedCount}** message(s). Reason: ${reason}${c ? ` | Case: #${c.id}` : ''}`).catch(() => {});
    return true;
  }

  return false;
}

module.exports = {
  moderationCommands,
  handleModerationCommand,
};
