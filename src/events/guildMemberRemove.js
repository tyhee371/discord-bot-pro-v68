const { Events, EmbedBuilder } = require('discord.js');
const { getGuildSettings } = require('../utils/settings');
const { applyPlaceholders } = require('../utils/placeholders');

function safeUrl(input) {
  try {
    if (!input) return null;
    const u = new URL(String(input));
    return u.href;
  } catch {
    return null;
  }
}

function parseColor(input) {
  if (input == null || input === '') return null;
  const s = String(input).trim();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return parseInt(hex, 16);
  }
  if (/^[0-9]{1,10}$/.test(s)) return Number(s);
  return null;
}

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(client, member) {
    const settings = await getGuildSettings(member.guild.id);
    const cfg = settings.leave ?? {};
    if (!cfg.enabled) return;
    if (!cfg.channelId) return;

    const channel = await member.guild.channels.fetch(cfg.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    const who = member;

    const content = applyPlaceholders(cfg.message ?? '{user} left the server.', who);

    let embeds = [];
    const e = cfg.embed ?? {};
    if (e.enabled) {
      const emb = new EmbedBuilder();

      const title = applyPlaceholders(e.title ?? '', who).trim();
      const desc = applyPlaceholders(e.description ?? '', who).trim();
      if (title) emb.setTitle(title.slice(0, 256));
      if (desc) emb.setDescription(desc.slice(0, 4096));

      const col = parseColor(e.color);
      if (col !== null) emb.setColor(col);

      const thumbUrl = safeUrl(e.thumbnailUrl);
      if (thumbUrl) emb.setThumbnail(thumbUrl);
      else if (e.thumbnail) emb.setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }));

      const img = safeUrl(e.imageUrl);
      if (img) emb.setImage(img);

      const footerEnabled = e.footerEnabled !== false;
      if (footerEnabled) {
        const footerText = applyPlaceholders(e.footerText ?? '', who).trim();
        const footerIcon = safeUrl(e.footerIconUrl);
        if (footerText || footerIcon) emb.setFooter({ text: footerText || '\u200b', ...(footerIcon ? { iconURL: footerIcon } : {}) });
        if (e.footerTimestamp) emb.setTimestamp();
      }

      embeds = [emb];
    }

    const msg = await channel.send({ content, embeds }).catch(() => null);
    if (msg && cfg.autoDeleteSeconds && Number(cfg.autoDeleteSeconds) > 0) {
      const delayMs = Math.max(1, Number(cfg.autoDeleteSeconds) * 1000);
      setTimeout(() => msg.delete().catch(() => {}), delayMs);
    }
  },
};
