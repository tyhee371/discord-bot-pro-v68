
const { Events, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { runRules } = require('../utils/ruleEngine');
const { getGuildSettings } = require('../utils/settings');
const { applyPlaceholders } = require('../utils/placeholders');

function parseColor(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number' && Number.isFinite(input)) return input;

  if (typeof input === 'string') {
    const s = input.trim();
    const hex = s.startsWith('#') ? s.slice(1) : s;
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return parseInt(hex, 16);
    if (/^\d+$/.test(s)) return Number(s);
  }
  return null;
}

function safeUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(client, member) {
    const settings = await getGuildSettings(member.guild.id);
    const cfg = settings?.greet ?? {};

    if (!cfg.enabled) return;

    const channelId = cfg.channelId;
    if (!channelId) {
      console.warn(`[GREET] enabled but no channelId set for guild ${member.guild.id}`);
      return;
    }

    const channel = await member.guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) {
      console.warn(`[GREET] greet channel missing/not text-based (${channelId}) in guild ${member.guild.id}`);
      return;
    }

    const me = member.guild.members.me;
    const perms = me ? channel.permissionsFor(me) : null;
    if (perms && (!perms.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.SendMessages))) {
      console.warn(`[GREET] missing perms in #${channel.name} (${channelId}) in guild ${member.guild.id}`);
      return;
    }

    const payload = {};

    const content = applyPlaceholders(cfg.message ?? '', member).trim();
    if (content) payload.content = content;

    const e = cfg.embed ?? {};
    if (e.enabled) {
      const embed = new EmbedBuilder();

      const title = applyPlaceholders(e.title ?? '', member).trim();
      const desc = applyPlaceholders(e.description ?? '', member).trim();

      if (title) embed.setTitle(title);
      if (desc) embed.setDescription(desc);

      const color = parseColor(e.color);
      if (color !== null) embed.setColor(color);

      // Thumbnail priority: explicit URL -> avatar toggle
      const thumbnailUrl = safeUrl(applyPlaceholders(e.thumbnailUrl ?? '', member).trim());
      if (thumbnailUrl) {
        embed.setThumbnail(thumbnailUrl);
      } else if (e.thumbnail) {
        embed.setThumbnail(member.user.displayAvatarURL({ size: 1024 }));
      }

      const imageUrl = safeUrl(applyPlaceholders(e.imageUrl ?? '', member).trim());
      if (imageUrl) embed.setImage(imageUrl);


const footerEnabled = e.footerEnabled !== false;
if (footerEnabled) {
  const footerText = applyPlaceholders(e.footerText ?? '', member).trim();
  const footerIconUrl = safeUrl(applyPlaceholders(e.footerIconUrl ?? '', member).trim());

  if (footerText || footerIconUrl) {
    embed.setFooter({ text: footerText || '\u200b', ...(footerIconUrl ? { iconURL: footerIconUrl } : {}) });
  }
  if (e.footerTimestamp) embed.setTimestamp();
}

      payload.embeds = [embed];
    }

    try {
      const msg = await channel.send(payload);

      if (msg && cfg.autoDeleteSeconds && Number(cfg.autoDeleteSeconds) > 0) {
        const delayMs = Math.max(1, Number(cfg.autoDeleteSeconds) * 1000);
        setTimeout(() => msg.delete().catch(() => {}), delayMs);
      }

      if (cfg.dmEnabled) {
        await member.send(payload).catch(() => {});
      }
    } catch (err) {
      console.error(`[GREET] Failed to send greeting in guild ${member.guild.id}:`, err);
    }
    // ── Automation rules ──────────────────────────────────────────────────
    if (member.guild) runRules(member.guild.id, 'member_join', { guild: member.guild, member, client }).catch(() => {});
  },
};
