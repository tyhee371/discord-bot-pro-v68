const { EmbedBuilder, ChannelType, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, GatewayIntentBits } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/settings');
const { isStaff } = require('../../utils/isStaff');
const { buildHelpEmbeds } = require('../../utils/helpBuilder');
const { buildActionEmbed } = require('../../utils/actionService');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { addWarn, listWarns } = require('../../services/moderationService');
const { db } = require('../../db');
const { getModLogConfig, resolveModLogChannel, createAndSendCase } = require('../../utils/modLogService');
const {
  enqueueAndMaybePlay,
  connectOnly,
  getConnectedChannelId,
  skip,
  pause,
  resume,
  stop,
  buildNowPlayingPayload,
  buildQueuePagePayload,
  setLoopMode,
  cycleLoopMode,
  jumpTo,
  set247,
  leave,
} = require('../../services/musicService');
const { runPrefixGuards } = require('../../shared/guards/guardPipeline');

const actionAliases = new Map([
  ['hug', 'hug'], ['h', 'hug'],
  ['kiss', 'kiss'], ['k', 'kiss'],
  ['slap', 'slap'],
  ['pat', 'pat'],
  ['cuddle', 'cuddle'],
  ['poke', 'poke'],
  ['bite', 'bite'],
  ['tickle', 'tickle'],
  ['wave', 'wave'],
  ['dance', 'dance'],
  ['blush', 'blush'],
  ['cry', 'cry'],
  ['smile', 'smile'],
]);

const moderationCommands = new Set(['kick', 'ban', 'timeout', 'warn', 'clear']);
const utilityCommands = new Set(['help', 'prefix', 'avatar', 'av', 'server', 'serverinfo', 'sinfo', 'si', 'guild', 'user', 'userinfo', 'whois']);
const musicDirect = new Set(['play', 'p', 'join', 'j', 'now', 'np', 'queue', 'q', 'skip', 'pause', 'resume', 'stop', 'loop', '247', 'leave']);

function parseArgs(content) {
  return content.trim().split(/\s+/).filter(Boolean);
}

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

function formatPresenceStatus(status) {
  if (!status) return null;
  if (status === 'online') return 'Online';
  if (status === 'idle') return 'Idle';
  if (status === 'dnd') return 'Do Not Disturb';
  if (status === 'offline') return 'Offline';
  return String(status);
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

async function handleFunAction(message, cmd, args) {
  const action = actionAliases.get(cmd);
  if (!action) return false;

  let targetUser = message.mentions.users.first() || null;
  const maybeId = args.find((a) => /^\d{15,20}$/.test(a));
  if (!targetUser && maybeId) {
    targetUser = await message.client.users.fetch(maybeId).catch(() => null);
  }

  const emb = await buildActionEmbed({
    action,
    actorUser: message.author,
    targetUser,
    guild: message.guild,
  });

  await message.reply({ embeds: [emb] }).catch(() => {});
  return true;
}

async function handleHelpCommand(message, prefix) {
  const helpCmd = require('../../commands/utility/help');
  const allEmbeds = await helpCmd.buildAllHelpEmbeds({ client: message.client, guild: message.guild, prefix });
  const groups = [];
  for (let i = 0; i < allEmbeds.length; i += 10) groups.push(allEmbeds.slice(i, i + 10));

  let dmOk = false;
  try {
    for (const g of groups) {
      await message.author.send({ embeds: g });
    }
    dmOk = true;
  } catch {
    dmOk = false;
  }

  const noticeEmbed = helpCmd.buildHelpNoticeEmbed({ dmOk, userId: message.author.id });
  const components = helpCmd.buildHelpLinkButtons();

  if (!dmOk) {
    const first = groups[0] || [];
    const rest = groups.slice(1);
    await message.reply({ embeds: [noticeEmbed, ...first], components, allowedMentions: { users: [message.author.id] } }).catch(() => {});
    for (const g of rest) {
      await message.channel.send({ embeds: g }).catch(() => {});
    }
    return true;
  }

  await message.reply({ embeds: [noticeEmbed], components, allowedMentions: { users: [message.author.id] } }).catch(() => {});
  return true;
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
      await message.reply('❌ That user is not in this server.').catch(() => {});
      return true;
    }

    if (user.id === message.author.id) {
      await message.reply('❌ You cannot kick yourself.').catch(() => {});
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
      await message.reply('❌ That user is not in this server.').catch(() => {});
      return true;
    }

    if (user.id === message.author.id) {
      await message.reply('❌ You cannot ban yourself.').catch(() => {});
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

    await message.reply(`🔨 Banned **${user.tag}**. Reason: ${reason}${c ? ` | Case: #${c.id}` : ''}`).catch(() => {});
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
      await message.reply('❌ That user is not in this server.').catch(() => {});
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

async function handleUtilityCommand(message, cmd, args, prefix, settings) {
  if (cmd === 'help') return handleHelpCommand(message, prefix);

  if (cmd === 'prefix') {
    const sub = (args.shift() || '').toLowerCase();
    if (!sub) {
      await message.reply(`Current prefix: \`${prefix}\``).catch(() => {});
      return true;
    }

    if (!isStaff(message.guild, message.member, settings)) {
      await message.reply('You do not have permission to change the prefix.').catch(() => {});
      return true;
    }

    if (sub === 'set') {
      const next = args[0] ?? '';
      if (!next || next.length > 5) {
        await message.reply('Usage: `!prefix set <newPrefix>` (max 5 chars)').catch(() => {});
        return true;
      }
      await setGuildSettings(message.guild.id, { prefix: next });
      await message.reply(`✅ Prefix set to \`${next}\``).catch(() => {});
      return true;
    }

    if (sub === 'reset') {
      await setGuildSettings(message.guild.id, { prefix: '!' });
      await message.reply('✅ Prefix reset to `!`').catch(() => {});
      return true;
    }

    await message.reply('Usage: `!prefix`, `!prefix set <new>`, `!prefix reset`').catch(() => {});
    return true;
  }

  if (cmd === 'avatar' || cmd === 'av') {
    const wantGlobal = (args[0] || '').toLowerCase() === 'global' || (args[1] || '').toLowerCase() === 'global';
    const mentionUser = message.mentions.users.first();
    let targetUser = mentionUser;
    let targetMember = null;

    const maybeId = args.find((a) => /^\d{15,20}$/.test(a));
    if (!targetUser && maybeId) {
      targetUser = await message.client.users.fetch(maybeId).catch(() => null);
    }
    if (!targetUser) targetUser = message.author;

    targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);

    const serverUrl = targetMember?.displayAvatarURL?.({ extension: 'png', size: 1024, forceStatic: false }) || targetUser.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: false });
    const globalUrl = targetUser.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: false });
    const sizes = [128, 256, 512, 1024, 2048, 4096];
    const links = (makeUrl) => sizes.map((s) => `[${s}](${makeUrl(s)})`).join(' • ');
    const selected = wantGlobal ? globalUrl : serverUrl;

    const emb = new EmbedBuilder()
      .setTitle(`${targetUser.tag}'s Avatar`)
      .setDescription(
        `**Selected:** ${wantGlobal ? 'Global avatar' : 'Server avatar'}\n` +
          `**Server:** ${links((s) => (targetMember ? targetMember.displayAvatarURL({ extension: 'png', size: s }) : globalUrl))}\n` +
          `**Global:** ${links((s) => targetUser.displayAvatarURL({ extension: 'png', size: s }))}`,
      )
      .setImage(selected)
      .setThumbnail(wantGlobal ? serverUrl : globalUrl);

    await message.reply({ embeds: [emb] }).catch(() => {});
    return true;
  }

  if (['server', 'serverinfo', 'sinfo', 'si', 'guild'].includes(cmd)) {
    const g = message.guild;
    const created = Math.floor(g.createdTimestamp / 1000);

    let owner = null;
    try {
      owner = await g.fetchOwner();
    } catch {
      owner = null;
    }

    const icon = g.iconURL({ size: 1024, extension: 'png' });
    const banner = g.bannerURL({ size: 2048, extension: 'png' });
    const splash = g.splashURL({ size: 2048, extension: 'png' });
    const discoverySplash = g.discoverySplashURL ? g.discoverySplashURL({ size: 2048, extension: 'png' }) : null;
    const ch = g.channels.cache;
    const catCount = ch.filter((c) => c.type === ChannelType.GuildCategory).size;
    const textCount = ch.filter((c) => c && c.type !== ChannelType.GuildCategory && c.isTextBased?.() && !String(c.type).includes('Thread')).size;
    const forumCount = ch.filter((c) => c.type === ChannelType.GuildForum).size;
    const voiceCount = ch.filter((c) => c?.isVoiceBased?.() && c.type !== ChannelType.GuildStageVoice).size;
    const stageCount = ch.filter((c) => c.type === ChannelType.GuildStageVoice).size;

    let humans = null;
    let bots = null;
    try {
      if (g.memberCount <= 2000) {
        const all = await g.members.fetch({ withPresences: false });
        bots = all.filter((m) => m.user?.bot).size;
        humans = all.size - bots;
      } else {
        bots = g.members.cache.filter((m) => m.user?.bot).size;
        humans = g.members.cache.size ? g.members.cache.filter((m) => !m.user?.bot).size : null;
      }
    } catch {
      bots = g.members.cache.filter((m) => m.user?.bot).size || null;
      humans = g.members.cache.size ? g.members.cache.filter((m) => !m.user?.bot).size : null;
    }

    const hasPresences = message.client?.options?.intents?.has?.(GatewayIntentBits.GuildPresences) || false;
    let online = null;
    if (hasPresences) {
      try {
        const all = await g.members.fetch({ withPresences: true });
        online = all.filter((m) => m.presence && m.presence.status !== 'offline').size;
      } catch {
        try {
          online = g.members.cache.filter((m) => m.presence && m.presence.status !== 'offline').size;
        } catch {
          online = null;
        }
      }
    }

    const rolesCount = g.roles.cache.size;
    const emojisCount = g.emojis.cache.size;
    const stickersCount = g.stickers?.cache?.size ?? 0;
    const boostCount = g.premiumSubscriptionCount ?? 0;
    const systemChannel = g.systemChannelId ? `<#${g.systemChannelId}>` : 'None';
    const rulesChannel = g.rulesChannelId ? `<#${g.rulesChannelId}>` : 'None';
    const afkChannel = g.afkChannelId ? `<#${g.afkChannelId}>` : 'None';
    const features = Array.isArray(g.features) && g.features.length ? g.features.slice(0, 20).map((f) => `\`${f}\``).join(', ') : null;

    const emb = new EmbedBuilder()
      .setTitle(`🏠 ${g.name}`)
      .setDescription([g.description ? g.description.slice(0, 240) : null, `**Server ID:** \`${g.id}\``].filter(Boolean).join('\n'))
      .setThumbnail(icon || null)
      .addFields(
        { name: '👑 Owner', value: owner ? `${owner.user} (\`${owner.id}\`)` : 'Unknown', inline: true },
        { name: '📅 Created', value: `<t:${created}:F>\n(<t:${created}:R>)`, inline: true },
        { name: '👥 Members', value: `Total: **${g.memberCount}**` + (humans != null && bots != null ? `\nHumans: **${humans}**\nBots: **${bots}**` : '') + (online != null ? `\nOnline: **${online}**` : `\nOnline: **Unknown** (enable Presence Intent)`), inline: true },
        { name: '💬 Channels', value: `Text: **${textCount}**\nVoice: **${voiceCount}**\nStage: **${stageCount}**\nForum: **${forumCount}**\nCategories: **${catCount}**`, inline: true },
        { name: '✨ Boosts', value: `Tier: **${g.premiumTier}**\nBoosts: **${boostCount}**`, inline: true },
        { name: '🧩 Roles / Emojis', value: `Roles: **${rolesCount}**\nEmojis: **${emojisCount}**\nStickers: **${stickersCount}**`, inline: true },
        { name: '🔐 Security', value: `Verification: **${g.verificationLevel}**\nNSFW Level: **${g.nsfwLevel ?? 'Unknown'}**\n2FA (MFA): **${g.mfaLevel ? 'On' : 'Off'}**`, inline: true },
        { name: '⚙️ Server Channels', value: `System: ${systemChannel}\nRules: ${rulesChannel}\nAFK: ${afkChannel}`, inline: true },
        { name: '🌍 Locale', value: `**${g.preferredLocale ?? 'Unknown'}**`, inline: true },
      )
      .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL({ size: 64 }) })
      .setTimestamp();

    if (features) emb.addFields({ name: '🌟 Features', value: features.slice(0, 1024), inline: false });
    if (banner) emb.setImage(banner);
    else if (discoverySplash) emb.setImage(discoverySplash);
    else if (splash) emb.setImage(splash);

    const links = [icon ? `[Icon](${icon})` : null, banner ? `[Banner](${banner})` : null, splash ? `[Splash](${splash})` : null, discoverySplash ? `[Discovery Splash](${discoverySplash})` : null].filter(Boolean);
    if (links.length) emb.addFields({ name: '🔗 Media', value: links.join(' • ').slice(0, 1024) });

    await message.reply({ embeds: [emb] }).catch(() => {});
    return true;
  }

  if (['user', 'userinfo', 'uinfo', 'ui', 'whois'].includes(cmd)) {
    const mentionUser = message.mentions.users.first();
    let targetUser = mentionUser;
    const maybeId = args.find((a) => /^\d{15,20}$/.test(a));
    if (!targetUser && maybeId) {
      targetUser = await message.client.users.fetch(maybeId).catch(() => null);
    }
    if (!targetUser) targetUser = message.author;

    const member = await message.guild.members.fetch(targetUser.id).catch(() => null);
    const created = Math.floor(targetUser.createdTimestamp / 1000);
    const joined = member?.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;

    let bannerUrl = null;
    let flagsText = null;
    try {
      const fresh = await targetUser.fetch(true);
      bannerUrl = fresh.bannerURL({ size: 2048, extension: 'png' });
      try {
        const flags = await fresh.fetchFlags();
        const arr = flags?.toArray?.() ?? [];
        flagsText = arr.length ? arr.map((f) => `\`${f}\``).join(' ') : null;
      } catch {
        flagsText = null;
      }
    } catch {
      bannerUrl = null;
      flagsText = null;
    }

    const serverAvatar = member ? member.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: false }) : targetUser.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: false });
    const globalAvatar = targetUser.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: false });
    const hasPresences = message.client?.options?.intents?.has?.(GatewayIntentBits.GuildPresences) || false;
    let status = member?.presence?.status ?? null;
    if (hasPresences && member && !status) {
      try {
        const freshMember = await message.guild.members.fetch({ user: targetUser.id, withPresences: true });
        status = freshMember?.presence?.status ?? null;
      } catch {}
    }

    const voice = member?.voice?.channelId ? `<#${member.voice.channelId}>` : null;
    const emb = new EmbedBuilder()
      .setTitle(`👤 ${targetUser.tag}`)
      .setThumbnail(serverAvatar)
      .setDescription(`${targetUser} ${targetUser.bot ? '🤖' : ''}`)
      .addFields(
        { name: '🆔 User ID', value: `\`${targetUser.id}\``, inline: true },
        { name: '📅 Account Created', value: `<t:${created}:F>\n(<t:${created}:R>)`, inline: true },
        { name: '📌 Joined Server', value: joined ? `<t:${joined}:F>\n(<t:${joined}:R>)` : 'Not in server', inline: true },
      );

    if (member) {
      const roles = member.roles.cache.filter((r) => r.id !== message.guild.id).sort((a, b) => b.position - a.position).map((r) => r.toString());
      emb.addFields(
        { name: '🏷️ Display Name', value: member.displayName || targetUser.username, inline: true },
        { name: '🎭 Top Role', value: member.roles.highest ? member.roles.highest.toString() : 'None', inline: true },
        { name: '📡 Status', value: status ? `**${formatPresenceStatus(status) || status}**` : (hasPresences ? '**Offline**' : 'Unknown (enable Presence Intent)'), inline: true },
      );
      if (voice) emb.addFields({ name: '🔊 Voice', value: voice, inline: true });
      if (member.premiumSinceTimestamp) {
        const boost = Math.floor(member.premiumSinceTimestamp / 1000);
        emb.addFields({ name: '✨ Boosting Since', value: `<t:${boost}:F>\n(<t:${boost}:R>)`, inline: true });
      }
      if (member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()) {
        const until = Math.floor(member.communicationDisabledUntilTimestamp / 1000);
        emb.addFields({ name: '⏳ Timeout Until', value: `<t:${until}:F>\n(<t:${until}:R>)`, inline: true });
      }
      emb.addFields({ name: `🧩 Roles (${roles.length})`, value: roles.length ? `${roles.slice(0, 25).join(' ')}${roles.length > 25 ? `\n+${roles.length - 25} more` : ''}` : 'None', inline: false });
    }

    if (flagsText) emb.addFields({ name: '🏅 Badges', value: flagsText.slice(0, 1024), inline: false });
    const sizes = [128, 256, 512, 1024, 2048, 4096];
    const links = (makeUrl) => sizes.map((s) => `[${s}](${makeUrl(s)})`).join(' • ');
    emb.addFields({ name: '🖼️ Server Avatar', value: links((s) => (member ? member.displayAvatarURL({ extension: 'png', size: s }) : globalAvatar)), inline: false });
    emb.addFields({ name: '🌐 Global Avatar', value: links((s) => targetUser.displayAvatarURL({ extension: 'png', size: s })), inline: false });
    if (bannerUrl) emb.setImage(bannerUrl);
    emb.setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL({ size: 64 }) }).setTimestamp();

    await message.reply({ embeds: [emb] }).catch(() => {});
    return true;
  }

  return false;
}

async function handleClearConfirmation(message, args, prefix) {
  const targetChannel = message.mentions.channels.first() || message.channel;
  const raw = (args.find((a) => a.toLowerCase() === 'all') || args.find((a) => /^\d+$/.test(a)) || '').toLowerCase();
  const me = await message.guild.members.fetchMe().catch(() => message.guild.members.me);
  const perms = targetChannel.permissionsFor(me);
  if (!perms?.has(PermissionsBitField.Flags.ViewChannel) || !perms?.has(PermissionsBitField.Flags.ManageMessages)) {
    await message.reply('❌ I need **View Channel** + **Manage Messages** in that channel to clear messages.').catch(() => {});
    return true;
  }

  if (!raw) {
    await message.reply(`Usage: \`${prefix}clear <all|number> [#channel]\``).catch(() => {});
    return true;
  }

  const clearAllRecent = async () => {
    let total = 0;
    while (true) {
      const msgs = await targetChannel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!msgs || msgs.size === 0) break;
      const deleted = await targetChannel.bulkDelete(msgs, true).catch(() => null);
      const count = deleted ? deleted.size : 0;
      total += count;
      if (count === 0) break;
      if (msgs.size < 100) break;
    }
    return total;
  };

  const clearAmount = async (n) => {
    let total = 0;
    let remaining = n;
    while (remaining > 0) {
      const batch = Math.min(100, remaining);
      const deleted = await targetChannel.bulkDelete(batch, true).catch(() => null);
      const count = deleted ? deleted.size : 0;
      total += count;
      remaining -= batch;
      if (count === 0) break;
    }
    return total;
  };

  try {
    if (raw === 'all') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pclear:yes:${message.author.id}:${targetChannel.id}`).setLabel('Confirm').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`pclear:no:${message.author.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );

      const confirmMsg = await message.reply({
        content: `⚠️ Confirm clearing **ALL recent messages** in ${targetChannel}?\n(Discord can’t bulk delete messages older than 14 days.)\n\nThis will expire in **60 seconds**.`,
        components: [row],
      }).catch(() => null);

      if (!confirmMsg) return true;

      try {
        const btn = await confirmMsg.awaitMessageComponent({
          time: 60_000,
          filter: (i) => i.user.id === message.author.id && (i.customId.startsWith('pclear:yes') || i.customId.startsWith('pclear:no')),
        });

        if (btn.customId.startsWith('pclear:no')) {
          await btn.update({ content: '✅ Cancelled.', components: [] }).catch(() => {});
          return true;
        }

        await btn.update({ content: '🧹 Clearing messages…', components: [] }).catch(() => {});
        const total = await clearAllRecent();
        await targetChannel.send(total > 0 ? `✅ Cleared **${total}** recent messages in ${targetChannel}. (Messages older than 14 days cannot be bulk deleted.)` : `⚠️ Nothing to delete in ${targetChannel} (or messages are older than 14 days).`).catch(() => {});
        return true;
      } catch {
        await confirmMsg.edit({ content: '⌛ Clear cancelled (no response within 60 seconds).', components: [] }).catch(() => {});
        return true;
      }
    }

    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) {
      await message.reply(`❌ Invalid amount. Use a number or \`${prefix}clear all\`.`).catch(() => {});
      return true;
    }

    const total = await clearAmount(Math.min(1000, Math.floor(n)));
    await message.reply(total > 0 ? `✅ Deleted **${total}** message(s) in ${targetChannel}. (Messages older than 14 days are skipped.)` : `⚠️ Nothing deleted (messages may be older than 14 days).`).catch(() => {});
    return true;
  } catch (err) {
    await message.reply('❌ Failed to clear messages.').catch(() => {});
    return true;
  }
}

async function handleMusicPrefix(message, action, args) {
  let command = action;
  if (command === 'p') command = 'play';
  if (command === 'j') command = 'join';
  if (command === 'np') command = 'now';
  if (command === 'q') command = 'queue';

  const voiceChannel = message.member?.voice?.channel;
  const inUse = getConnectedChannelId(message.guild.id);
  const me = await message.guild.members.fetchMe().catch(() => message.guild.members.me);
  const needed = ['ViewChannel', 'Connect', 'Speak'];
  const missingPerms = voiceChannel ? needed.filter((p) => !voiceChannel.permissionsFor(me)?.has(p)) : needed;

  if (command === 'join') {
    if (!voiceChannel) {
      await message.reply('❌ You are not in a voice channel. Join one first.').catch(() => {});
      return true;
    }
    if (inUse && inUse !== voiceChannel.id) {
      await message.reply(`🔒 Already in use in <#${inUse}>.`).catch(() => {});
      return true;
    }
    if (missingPerms.length) {
      await message.reply(`❌ I can’t join ${voiceChannel}. Missing: **${missingPerms.join(', ')}**. Please allow **View Channel / Connect / Speak** for me in that channel.`).catch(() => {});
      return true;
    }

    try {
      await connectOnly({ client: message.client, guild: message.guild, voiceChannel, textChannelId: message.channel?.id ?? message.channelId, setAnnounceChannel: true });
      await message.reply(`✅ Joined ${voiceChannel}.`).catch(() => {});
    } catch (e) {
      await message.reply('Could not join that voice channel.').catch(() => {});
    }
    return true;
  }

  if (command === 'play') {
    const query = args.join(' ');
    if (!query) {
      await message.reply('Please provide a song name or URL.').catch(() => {});
      return true;
    }
    if (!voiceChannel) {
      await message.reply('❌ You are not in a voice channel. Join one first, then try again.').catch(() => {});
      return true;
    }
    if (inUse && inUse !== voiceChannel.id) {
      await message.reply(`🔒 Already in use in <#${inUse}>.`).catch(() => {});
      return true;
    }
    if (missingPerms.length) {
      await message.reply(`❌ I can’t join ${voiceChannel}. Missing: **${missingPerms.join(', ')}**. Please allow **View Channel / Connect / Speak** for me in that channel.`).catch(() => {});
      return true;
    }

    try {
      const { tracksAdded } = await enqueueAndMaybePlay({
        client: message.client,
        guild: message.guild,
        voiceChannel,
        textChannelId: message.channel?.id ?? message.channelId,
        setAnnounceChannel: true,
        query,
        requestedBy: { id: message.author.id, tag: message.author.tag },
      });
      await message.reply(`✅ Added **${tracksAdded}** track(s) to the queue.`).catch(() => {});
    } catch (e) {
      await message.reply('Could not play that. Try a different link or search.').catch(() => {});
    }
    return true;
  }

  if (command === 'now') {
    const payload = buildNowPlayingPayload(message.guild.id);
    await message.channel.send(payload).catch(() => {});
    return true;
  }

  if (command === 'queue') {
    const page = args[0] ? Math.max(0, Number(args[0]) - 1) : 0;
    const payload = buildQueuePagePayload(message.guild.id, page, 10);
    await message.channel.send(payload).catch(() => {});
    return true;
  }

  if (command === 'skip') {
    const n = args[0] ? Number(args[0]) : null;
    if (n && Number.isFinite(n) && n > 0) {
      try {
        await jumpTo(message.guild.id, n);
        await message.reply(`⏭️ Jumped to queue position **${n}**.`).catch(() => {});
      } catch (e) {
        await message.reply(`Could not jump. ${e?.message ? `(${e.message})` : ''}`).catch(() => {});
      }
      return true;
    }
    const ok = await skip(message.guild.id);
    await message.reply(ok ? '⏭️ Skipped.' : 'Nothing to skip.').catch(() => {});
    return true;
  }

  if (command === 'pause') {
    const ok = pause(message.guild.id);
    await message.reply(ok ? '⏸️ Paused.' : 'Nothing to pause.').catch(() => {});
    return true;
  }

  if (command === 'resume') {
    const ok = resume(message.guild.id);
    await message.reply(ok ? '▶️ Resumed.' : 'Nothing to resume.').catch(() => {});
    return true;
  }

  if (command === 'stop') {
    await stop(message.guild.id);
    await message.reply('🛑 Stopped.').catch(() => {});
    return true;
  }

  if (command === 'loop') {
    const mode = (args[0] || '').toLowerCase();
    try {
      const next = mode ? setLoopMode(message.guild.id, mode) : cycleLoopMode(message.guild.id);
      await message.reply(`🔁 Loop mode: **${next}**`).catch(() => {});
    } catch (e) {
      await message.reply(`Could not set loop mode. ${e?.message ? `(${e.message})` : ''}`).catch(() => {});
    }
    return true;
  }

  if (command === '247') {
    const mode = (args[0] || '').toLowerCase();
    let enabled;
    if (mode === 'on' || mode === 'true' || mode === 'yes') enabled = true;
    else if (mode === 'off' || mode === 'false' || mode === 'no') enabled = false;
    else enabled = true;
    const st = await set247(message.guild.id, enabled);
    await message.reply(`📻 24/7 mode is now **${st ? 'ON' : 'OFF'}**`).catch(() => {});
    return true;
  }

  if (command === 'leave') {
    await leave(message.guild.id, 'Leave (prefix command)');
    await message.reply('👋 Left the voice channel.').catch(() => {});
    return true;
  }

  return false;
}

async function handleOldMusicCommand(message, args, prefix) {
  const sub = (args.shift() || '').toLowerCase();
  if (!sub) {
    await message.reply(`Usage: \`${prefix}play <query>\`, \`${prefix}skip [number]\`, \`${prefix}queue [page]\`, \`${prefix}now\`, \`${prefix}pause\`, \`${prefix}resume\`, \`${prefix}stop\`, \`${prefix}loop [off|track|queue]\`, \`${prefix}vol <0-2>\`, \`${prefix}247 on|off\`, \`${prefix}leave\``).catch(() => {});
    return true;
  }

  return handleMusicPrefix(message, sub, args);
}

function appliedLevelKey(guildId, userId) {
  return `warnLevelApplied:${guildId}:${userId}`;
}

function getPrefixGuardConfig(cmd) {
  if (moderationCommands.has(cmd)) {
    return { moduleKey: 'moderation', cooldownSeconds: 2, ownerOnly: false };
  }
  if (musicDirect.has(cmd) || cmd === 'music') {
    return { moduleKey: 'music', cooldownSeconds: 2, ownerOnly: false };
  }
  if (utilityCommands.has(cmd)) {
    return { moduleKey: 'utility', cooldownSeconds: 2, ownerOnly: false };
  }
  if (actionAliases.has(cmd)) {
    return { moduleKey: 'fun', cooldownSeconds: 1, ownerOnly: false };
  }
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

  const guardMeta = getPrefixGuardConfig(cmd);
  const guard = await runPrefixGuards({ message, commandName: cmd, ...guardMeta });
  if (!guard.ok) return;

  if (actionAliases.has(cmd)) {
    await handleFunAction(message, cmd, args);
    return;
  }

  if (cmd === 'help') {
    await handleHelpCommand(message, prefix);
    return;
  }

  if (moderationCommands.has(cmd)) {
    await handleModerationCommand(message, cmd, args, settings);
    return;
  }

  if (utilityCommands.has(cmd)) {
    await handleUtilityCommand(message, cmd, args, prefix, settings);
    return;
  }

  if (musicDirect.has(cmd)) {
    await handleMusicPrefix(message, cmd, args);
    return;
  }

  if (cmd === 'music') {
    await handleOldMusicCommand(message, args, prefix);
    return;
  }

  return;
}

module.exports = {
  handlePrefixMessage,
  getPrefixGuardConfig,
};