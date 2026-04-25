const { Events, EmbedBuilder, ChannelType } = require('discord.js');
const { getLogConfig, sendLogEmbed, findChannelUpdateAudit, safeField } = require('../utils/logService');

function typeName(ch) {
  try {
    return String(ch.type);
  } catch {
    return 'unknown';
  }
}

function parentName(guild, ch) {
  return (
    ch.parent?.name ||
    (ch.parentId ? (guild.channels.cache.get(ch.parentId)?.name ?? 'unknown') : 'None')
  );
}

module.exports = {
  name: Events.ChannelUpdate,
  async execute(client, oldChannel, newChannel) {
    try {
      const guild = newChannel.guild;
      if (!guild) return;

      const cfg = await getLogConfig(guild.id);
      if (!cfg.enabled || !cfg.events.channelUpdate) return;

      // Only guild channels
      if (!newChannel?.id) return;

      // Changes we care about (Arcane-style Before/After)
      const changes = [];

      if (oldChannel.name !== newChannel.name) {
        changes.push({
          label: 'Name',
          before: oldChannel.name ?? 'unknown',
          after: newChannel.name ?? 'unknown',
        });
      }

      // Topic (text)
      if ('topic' in oldChannel && 'topic' in newChannel && oldChannel.topic !== newChannel.topic) {
        changes.push({
          label: 'Topic',
          before: oldChannel.topic ?? '(none)',
          after: newChannel.topic ?? '(none)',
        });
      }

      // NSFW
      if ('nsfw' in oldChannel && 'nsfw' in newChannel && oldChannel.nsfw !== newChannel.nsfw) {
        changes.push({
          label: 'NSFW',
          before: oldChannel.nsfw ? 'On' : 'Off',
          after: newChannel.nsfw ? 'On' : 'Off',
        });
      }

      // Slowmode
      if ('rateLimitPerUser' in oldChannel && 'rateLimitPerUser' in newChannel && oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        changes.push({
          label: 'Slowmode',
          before: `${oldChannel.rateLimitPerUser ?? 0}s`,
          after: `${newChannel.rateLimitPerUser ?? 0}s`,
        });
      }

      // Voice settings
      if ('bitrate' in oldChannel && 'bitrate' in newChannel && oldChannel.bitrate !== newChannel.bitrate) {
        changes.push({
          label: 'Bitrate',
          before: `${oldChannel.bitrate ?? 0}`,
          after: `${newChannel.bitrate ?? 0}`,
        });
      }

      if ('userLimit' in oldChannel && 'userLimit' in newChannel && oldChannel.userLimit !== newChannel.userLimit) {
        changes.push({
          label: 'User Limit',
          before: `${oldChannel.userLimit ?? 0}`,
          after: `${newChannel.userLimit ?? 0}`,
        });
      }

      // Parent/category change
      if (oldChannel.parentId !== newChannel.parentId) {
        changes.push({
          label: 'Category',
          before: parentName(guild, oldChannel),
          after: parentName(guild, newChannel),
        });
      }

      if (!changes.length) return;

      // Audit (who changed)
      const audit = await findChannelUpdateAudit(guild, newChannel.id);
      const executor = audit?.executor ?? null;

      const isVoice = newChannel.type === ChannelType.GuildVoice || newChannel.type === ChannelType.GuildStageVoice;
      const color = 0xe056fd; // Arcane-ish purple

      const emb = new EmbedBuilder()
        .setTitle(`Channel "${newChannel.name ?? "unknown"}" updated`)
        .setColor(color)
        .addFields(
          {
            name: 'Before',
            value: safeField(changes.map((c) => `**${c.label}:** ${String(c.before)}`).join('\n')),
            inline: true,
          },
          {
            name: 'After',
            value: safeField(changes.map((c) => `**${c.label}:** ${String(c.after)}`).join('\n')),
            inline: true,
          },
        )
        .setFooter({ text: `Channel ID: ${newChannel.id}` })
        .setTimestamp();

      if (executor) {
        emb.setAuthor({ name: `${executor.tag ?? executor.username ?? 'Unknown'}`, iconURL: executor.displayAvatarURL?.({ size: 128 }) });
      }

      await sendLogEmbed(guild, emb);
    } catch {}
  },
};
