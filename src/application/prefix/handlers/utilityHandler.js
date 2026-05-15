/**
 * Utility command handler (prefix)
 * Handles: help, prefix, avatar/av, server/serverinfo/sinfo/si/guild, user/userinfo/uinfo/ui/whois
 */

const { EmbedBuilder, ChannelType, GatewayIntentBits } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../../utils/settings');
const { isStaff } = require('../../../utils/isStaff');

const utilityCommands = new Set([
  'help', 'prefix',
  'avatar', 'av',
  'server', 'serverinfo', 'sinfo', 'si', 'guild',
  'user', 'userinfo', 'uinfo', 'ui', 'whois',
]);

function formatPresenceStatus(status) {
  if (!status) return null;
  if (status === 'online') return 'Online';
  if (status === 'idle') return 'Idle';
  if (status === 'dnd') return 'Do Not Disturb';
  if (status === 'offline') return 'Offline';
  return String(status);
}

async function handleHelpCommand(message, prefix) {
  const helpCmd = require('../../../commands/utility/help');
  const allEmbeds = await helpCmd.buildAllHelpEmbeds({
    client: message.client,
    prefix,
    member: message.member,
    userId: message.author.id,
  });
  const groups = [];
  for (let i = 0; i < allEmbeds.length; i += 10) groups.push(allEmbeds.slice(i, i + 10));

  let dmOk = false;
  try {
    for (const g of groups) await message.author.send({ embeds: g });
    dmOk = true;
  } catch {
    dmOk = false;
  }

  const noticeEmbed = helpCmd.buildHelpNoticeEmbed({ dmOk, userId: message.author.id });
  const components = helpCmd.buildHelpLinkButtons();

  if (!dmOk) {
    const first = groups[0] || [];
    const rest = groups.slice(1);
    await message
      .reply({ embeds: [noticeEmbed, ...first], components, allowedMentions: { users: [message.author.id] } })
      .catch(() => {});
    for (const g of rest) await message.channel.send({ embeds: g }).catch(() => {});
    return true;
  }

  await message
    .reply({ embeds: [noticeEmbed], components, allowedMentions: { users: [message.author.id] } })
    .catch(() => {});
  return true;
}

async function handlePrefixCommand(message, args, prefix) {
  const sub = (args.shift() || '').toLowerCase();
  const settings = await getGuildSettings(message.guild.id);

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

async function handleAvatarCommand(message, args) {
  const wantGlobal =
    (args[0] || '').toLowerCase() === 'global' || (args[1] || '').toLowerCase() === 'global';
  const mentionUser = message.mentions.users.first();
  let targetUser = mentionUser;

  const maybeId = args.find((a) => /^\d{15,20}$/.test(a));
  if (!targetUser && maybeId) {
    targetUser = await message.client.users.fetch(maybeId).catch(() => null);
  }
  if (!targetUser) targetUser = message.author;

  const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);

  const serverUrl =
    targetMember?.displayAvatarURL?.({ extension: 'png', size: 1024, forceStatic: false }) ||
    targetUser.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: false });
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

async function handleServerCommand(message) {
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
  const textCount = ch.filter(
    (c) => c && c.type !== ChannelType.GuildCategory && c.isTextBased?.() && !String(c.type).includes('Thread'),
  ).size;
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
  const features =
    Array.isArray(g.features) && g.features.length
      ? g.features
          .slice(0, 20)
          .map((f) => `\`${f}\``)
          .join(', ')
      : null;

  const emb = new EmbedBuilder()
    .setTitle(`🏠 ${g.name}`)
    .setDescription(
      [g.description ? g.description.slice(0, 240) : null, `**Server ID:** \`${g.id}\``]
        .filter(Boolean)
        .join('\n'),
    )
    .setThumbnail(icon || null)
    .addFields(
      { name: '👑 Owner', value: owner ? `${owner.user} (\`${owner.id}\`)` : 'Unknown', inline: true },
      { name: '📅 Created', value: `<t:${created}:F>\n(<t:${created}:R>)`, inline: true },
      {
        name: '👥 Members',
        value:
          `Total: **${g.memberCount}**` +
          (humans != null && bots != null ? `\nHumans: **${humans}**\nBots: **${bots}**` : '') +
          (online != null
            ? `\nOnline: **${online}**`
            : `\nOnline: **Unknown** (enable Presence Intent)`),
        inline: true,
      },
      {
        name: '💬 Channels',
        value: `Text: **${textCount}**\nVoice: **${voiceCount}**\nStage: **${stageCount}**\nForum: **${forumCount}**\nCategories: **${catCount}**`,
        inline: true,
      },
      { name: '✨ Boosts', value: `Tier: **${g.premiumTier}**\nBoosts: **${boostCount}**`, inline: true },
      {
        name: '🧩 Roles / Emojis',
        value: `Roles: **${rolesCount}**\nEmojis: **${emojisCount}**\nStickers: **${stickersCount}**`,
        inline: true,
      },
      {
        name: '🔐 Security',
        value: `Verification: **${g.verificationLevel}**\nNSFW Level: **${g.nsfwLevel ?? 'Unknown'}**\n2FA (MFA): **${g.mfaLevel ? 'On' : 'Off'}**`,
        inline: true,
      },
      {
        name: '⚙️ Server Channels',
        value: `System: ${systemChannel}\nRules: ${rulesChannel}\nAFK: ${afkChannel}`,
        inline: true,
      },
      { name: '🌍 Locale', value: `**${g.preferredLocale ?? 'Unknown'}**`, inline: true },
    )
    .setFooter({
      text: `Requested by ${message.author.tag}`,
      iconURL: message.author.displayAvatarURL({ size: 64 }),
    })
    .setTimestamp();

  if (features) emb.addFields({ name: '🌟 Features', value: features.slice(0, 1024), inline: false });
  if (banner) emb.setImage(banner);
  else if (discoverySplash) emb.setImage(discoverySplash);
  else if (splash) emb.setImage(splash);

  const mediaLinks = [
    icon ? `[Icon](${icon})` : null,
    banner ? `[Banner](${banner})` : null,
    splash ? `[Splash](${splash})` : null,
    discoverySplash ? `[Discovery Splash](${discoverySplash})` : null,
  ].filter(Boolean);
  if (mediaLinks.length)
    emb.addFields({ name: '🔗 Media', value: mediaLinks.join(' • ').slice(0, 1024) });

  await message.reply({ embeds: [emb] }).catch(() => {});
  return true;
}

async function handleUserCommand(message, args) {
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

  const serverAvatar = member
    ? member.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: false })
    : targetUser.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: false });
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
      {
        name: '📌 Joined Server',
        value: joined ? `<t:${joined}:F>\n(<t:${joined}:R>)` : 'Not in server',
        inline: true,
      },
    );

  if (member) {
    const roles = member.roles.cache
      .filter((r) => r.id !== message.guild.id)
      .sort((a, b) => b.position - a.position)
      .map((r) => r.toString());
    emb.addFields(
      { name: '🏷️ Display Name', value: member.displayName || targetUser.username, inline: true },
      { name: '🎭 Top Role', value: member.roles.highest ? member.roles.highest.toString() : 'None', inline: true },
      {
        name: '📡 Status',
        value: status
          ? `**${formatPresenceStatus(status) || status}**`
          : hasPresences
            ? '**Offline**'
            : 'Unknown (enable Presence Intent)',
        inline: true,
      },
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
    emb.addFields({
      name: `🧩 Roles (${roles.length})`,
      value: roles.length
        ? `${roles.slice(0, 25).join(' ')}${roles.length > 25 ? `\n+${roles.length - 25} more` : ''}`
        : 'None',
      inline: false,
    });
  }

  if (flagsText) emb.addFields({ name: '🏅 Badges', value: flagsText.slice(0, 1024), inline: false });
  const sizes = [128, 256, 512, 1024, 2048, 4096];
  const links = (makeUrl) => sizes.map((s) => `[${s}](${makeUrl(s)})`).join(' • ');
  emb.addFields({
    name: '🖼️ Server Avatar',
    value: links((s) => (member ? member.displayAvatarURL({ extension: 'png', size: s }) : globalAvatar)),
    inline: false,
  });
  emb.addFields({
    name: '🌐 Global Avatar',
    value: links((s) => targetUser.displayAvatarURL({ extension: 'png', size: s })),
    inline: false,
  });
  if (bannerUrl) emb.setImage(bannerUrl);
  emb
    .setFooter({
      text: `Requested by ${message.author.tag}`,
      iconURL: message.author.displayAvatarURL({ size: 64 }),
    })
    .setTimestamp();

  await message.reply({ embeds: [emb] }).catch(() => {});
  return true;
}

async function handleUtilityCommand(message, cmd, args, prefix) {
  if (cmd === 'help') return handleHelpCommand(message, prefix);
  if (cmd === 'prefix') return handlePrefixCommand(message, args, prefix);
  if (cmd === 'avatar' || cmd === 'av') return handleAvatarCommand(message, args);
  if (['server', 'serverinfo', 'sinfo', 'si', 'guild'].includes(cmd)) return handleServerCommand(message);
  if (['user', 'userinfo', 'uinfo', 'ui', 'whois'].includes(cmd)) return handleUserCommand(message, args);
  return false;
}

module.exports = {
  utilityCommands,
  handleUtilityCommand,
};
