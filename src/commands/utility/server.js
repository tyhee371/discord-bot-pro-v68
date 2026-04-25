const { SlashCommandBuilder, EmbedBuilder, ChannelType, GatewayIntentBits } = require('discord.js');
const { safeReply, safeDefer } = require('../../utils/safeReply');

function safeField(v) {
  if (v == null) return 'Unknown';
  const s = String(v);
  return s.length ? (s.length > 1024 ? s.slice(0, 1021) + '…' : s) : 'Unknown';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('Show server information (members, channels, boosts, media).'),
  async execute(interaction) {
    const g = interaction.guild;
    if (!g) return safeReply(interaction, { content: 'This command can only be used in a server.', ephemeral: true });

    // interactionCreate in this bot may auto-defer; use editReply when needed.
    const replyOrEdit = async (payload) => {
      const clean = { ...payload };
      delete clean.ephemeral;
      delete clean.flags;
      if (interaction.deferred || interaction.replied) return interaction.editReply(clean);
      return safeReply(interaction, { ...payload, ephemeral: true });
    };

    if (!interaction.deferred && !interaction.replied) {
      try { await safeDefer(interaction, { ephemeral: true }); } catch {}
    }

    const created = Math.floor(g.createdTimestamp / 1000);

    let owner = null;
    try { owner = await g.fetchOwner(); } catch { owner = null; }

    const icon = g.iconURL({ size: 1024, extension: 'png' });
    const banner = g.bannerURL({ size: 2048, extension: 'png' });
    const splash = g.splashURL({ size: 2048, extension: 'png' });
    const discoverySplash = g.discoverySplashURL ? g.discoverySplashURL({ size: 2048, extension: 'png' }) : null;

    const ch = g.channels.cache;
    const catCount = ch.filter((c) => c.type === ChannelType.GuildCategory).size;

    const textCount = ch.filter(
      (c) =>
        c &&
        c.type !== ChannelType.GuildCategory &&
        c.isTextBased?.() &&
        !String(c.type).includes('Thread'),
    ).size;

    const forumCount = ch.filter((c) => c.type === ChannelType.GuildForum).size;
    const voiceCount = ch.filter((c) => c?.isVoiceBased?.() && c.type !== ChannelType.GuildStageVoice).size;
    const stageCount = ch.filter((c) => c.type === ChannelType.GuildStageVoice).size;

    // Member breakdown (best-effort)
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

    // Online count (requires Presence Intent)
    const hasPresences = interaction.client?.options?.intents?.has?.(GatewayIntentBits.GuildPresences) || false;
    let online = null;
    if (hasPresences) {
      try {
        const all = await g.members.fetch({ withPresences: true });
        online = all.filter((m) => m.presence && m.presence.status !== 'offline').size;
      } catch {
        online = g.members.cache.filter((m) => m.presence && m.presence.status !== 'offline').size;
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
        ? g.features.slice(0, 20).map((f) => `\`${f}\``).join(', ')
        : null;

    const emb = new EmbedBuilder()
      .setTitle(`🏠 ${g.name}`)
      .setDescription([g.description ? g.description.slice(0, 240) : null, `**Server ID:** \`${g.id}\``].filter(Boolean).join('\n'))
      .setThumbnail(icon || null)
      .addFields(
        { name: '👑 Owner', value: owner ? `${owner.user} (\`${owner.id}\`)` : 'Unknown', inline: true },
        { name: '📅 Created', value: `<t:${created}:F>\n(<t:${created}:R>)`, inline: true },
        {
          name: '👥 Members',
          value:
            `Total: **${g.memberCount}**` +
            (humans != null && bots != null ? `\nHumans: **${humans}**\nBots: **${bots}**` : '') +
            (online != null ? `\nOnline: **${online}**` : (hasPresences ? '' : `\nOnline: **Unknown** (enable Presence Intent)`)),
          inline: true,
        },
        { name: '💬 Channels', value: `Text: **${textCount}**\nVoice: **${voiceCount}**\nStage: **${stageCount}**\nForum: **${forumCount}**\nCategories: **${catCount}**`, inline: true },
        { name: '✨ Boosts', value: `Tier: **${g.premiumTier}**\nBoosts: **${boostCount}**`, inline: true },
        { name: '🧩 Roles / Emojis', value: `Roles: **${rolesCount}**\nEmojis: **${emojisCount}**\nStickers: **${stickersCount}**`, inline: true },
        { name: '🔐 Security', value: `Verification: **${g.verificationLevel}**\nNSFW Level: **${g.nsfwLevel ?? 'Unknown'}**\n2FA (MFA): **${g.mfaLevel ? 'On' : 'Off'}**`, inline: true },
        { name: '⚙️ Server Channels', value: `System: ${systemChannel}\nRules: ${rulesChannel}\nAFK: ${afkChannel}`, inline: true },
        { name: '🌍 Locale', value: `**${g.preferredLocale ?? 'Unknown'}**`, inline: true },
      )
      .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL({ size: 64 }) })
      .setTimestamp();

    if (features) emb.addFields({ name: '🌟 Features', value: safeField(features) });

    if (banner) emb.setImage(banner);
    else if (discoverySplash) emb.setImage(discoverySplash);
    else if (splash) emb.setImage(splash);

    const links = [icon ? `[Icon](${icon})` : null, banner ? `[Banner](${banner})` : null, splash ? `[Splash](${splash})` : null, discoverySplash ? `[Discovery Splash](${discoverySplash})` : null].filter(Boolean);
    if (links.length) emb.addFields({ name: '🔗 Media', value: safeField(links.join(' • ')) });

    return replyOrEdit({ embeds: [emb] });
  },
};