const { Events, EmbedBuilder } = require('discord.js');
const { getLogConfig, sendLogEmbed, safeField, safeUrl, findMessageBulkDeleteAudit } = require('../utils/logService');

function formatOne(m) {
  const author = m.author ? `${m.author.tag}` : 'Unknown';
  const content = (m.content || '').trim();
  const atts = Array.from(m.attachments?.values?.() ?? []);
  const links = atts.length
    ? atts
        .slice(0, 6)
        .map((a) => {
          const u = safeUrl(a.url);
          const n = a.name ?? 'file';
          return u ? `📎 [${n}](${u})` : `📎 ${n}`;
        })
        .join(' ')
    : '';

  const body = content ? content : (links ? '(attachments)' : '(no content)');
  const withLinks = links ? `${body} ${links}` : body;
  return `• **${author}**: ${safeField(withLinks)}`;
}

module.exports = {
  name: Events.MessageBulkDelete,
  async execute(client, messages, channel) {
    try {
      const guild = channel.guild;
      if (!guild) return;

      const cfg = await getLogConfig(guild.id);
      if (!cfg.enabled || !cfg.events.bulkDelete) return;

      const count = messages?.size ?? 0;
      if (!count) return;

      // Audit log (who bulk deleted)
      const audit = await findMessageBulkDeleteAudit(guild, channel.id);
      const executor = audit?.executor ?? null;

      // Unique authors (best effort)
      const uniq = new Set();
      for (const m of messages.values()) {
        if (m.author?.id) uniq.add(m.author.id);
      }

      const sample = Array.from(messages.values())
        .sort((a, b) => (b.createdTimestamp ?? 0) - (a.createdTimestamp ?? 0))
        .slice(0, 10)
        .map(formatOne)
        .join('\n');

      const emb = new EmbedBuilder()
        .setTitle(`Messages bulk deleted in #${channel?.name ?? 'unknown'}`)
        .setColor(0xe74c3c)
        .setDescription(executor ? `Deleted by ${executor}` : null)
        .addFields(
          { name: 'Count', value: `**${count}**`, inline: true },
          { name: 'Unique authors', value: `**${uniq.size}**`, inline: true },
        )
        .setFooter({ text: `Channel ID: ${channel.id}` })
        .setTimestamp();

      if (sample) emb.addFields({ name: 'Sample (latest 10)', value: safeField(sample).slice(0, 1024) });

      await sendLogEmbed(guild, emb);
    } catch {}
  },
};
