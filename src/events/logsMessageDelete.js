const { Events, EmbedBuilder } = require('discord.js');
const { getLogConfig, sendLogEmbed, safeField, safeUrl, findMessageDeleteAudit } = require('../utils/logService');

module.exports = {
  name: Events.MessageDelete,
  async execute(client, message) {
    try {
      if (!message.guild) return;
      const guild = message.guild;

      const cfg = await getLogConfig(guild.id);
      if (!cfg.enabled || !cfg.events.messageDelete) return;

      if (message.partial && message.fetch) {
        message = await message.fetch().catch(() => message);
      }

      if (cfg.ignoreBots && message.author?.bot) return;

      const channel = message.channel;
const author = message.author;

const atts = Array.from(message.attachments?.values?.() ?? []);
const hasText = Boolean(message.content && String(message.content).trim().length);

const attachmentLinks = atts.length
  ? atts
      .slice(0, 25)
      .map((a) => {
        const url = safeUrl(a.url);
        const name = a.name ?? 'file';
        return url ? `📎 [${name}](${url})` : `📎 ${name}`;
      })
      .join(' ')
  : null;

const contentField = hasText
  ? safeField(message.content + (attachmentLinks ? `

${attachmentLinks}` : ''))
  : safeField(attachmentLinks || '(no text)');

// Audit log (who deleted) — only exists for mod deletes / bulk deletes
const audit = author?.id ? await findMessageDeleteAudit(guild, author.id, channel.id) : null;
const deleter = audit?.executor ?? null;
const showDeleter = deleter && deleter.id && deleter.id !== author?.id;

const emb = new EmbedBuilder()
  .setAuthor({ name: `${author?.tag ?? 'Unknown'}`, iconURL: author?.displayAvatarURL?.({ size: 128 }) })
  .setTitle(`Message deleted in #${channel?.name ?? 'unknown'}`)
  .setColor(0xe74c3c)
  .setDescription(`${author ?? ''}`.trim() || null)
  .addFields({ name: 'Content', value: contentField, inline: false })
  .setFooter({ text: `User ID: ${author?.id ?? 'unknown'}` })
  .setTimestamp();

if (showDeleter) {
  emb.addFields({ name: 'Deleted by', value: `${deleter}`, inline: false });
}

// If an attachment image existed, show it as preview
if (atts.length) {
  const img = atts.find((a) => a.url && /\.(png|jpe?g|gif|webp)$/i.test(a.url));
  const url = img ? safeUrl(img.url) : null;
  if (url) emb.setImage(url);
}

await sendLogEmbed(guild, emb);
    } catch {}
  },
};
