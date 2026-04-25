const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getLogConfig, sendLogEmbed, safeField, clamp, safeUrl } = require('../utils/logService');

function contentOrPlaceholder(msg) {
  const c = msg?.content ?? '';
  return c && c.trim().length ? c : '(no text)';
}

module.exports = {
  name: Events.MessageUpdate,
  async execute(client, oldMessage, newMessage) {
    try {
      if (!newMessage.guild) return;

      const guild = newMessage.guild;
      const cfg = await getLogConfig(guild.id);
      if (!cfg.enabled) return;
      if (cfg.ignoreBots && newMessage.author?.bot) return;

      // Try fetch full message if partial
      if (newMessage.partial && newMessage.fetch) {
        newMessage = await newMessage.fetch().catch(() => newMessage);
      }
      if (oldMessage.partial && oldMessage.fetch) {
        oldMessage = await oldMessage.fetch().catch(() => oldMessage);
      }

      const channel = newMessage.channel;
      const jumpUrl = newMessage.url || null;

      // Attachment removed detection
      const oldAtt = oldMessage.attachments?.map?.((a) => a) ?? Array.from(oldMessage.attachments?.values?.() ?? []);
      const newAtt = newMessage.attachments?.map?.((a) => a) ?? Array.from(newMessage.attachments?.values?.() ?? []);
      const oldIds = new Set(oldAtt.map((a) => a.id));
      const newIds = new Set(newAtt.map((a) => a.id));
      const removed = oldAtt.filter((a) => !newIds.has(a.id));

      if (removed.length && cfg.events.attachmentRemove) {
        const first = removed[0];
        const url = safeUrl(first.url);
        const isImg = url && /\.(png|jpe?g|gif|webp)$/i.test(url);

        const emb = new EmbedBuilder()
          .setAuthor({ name: `${newMessage.author?.tag ?? 'Unknown'}`, iconURL: newMessage.author?.displayAvatarURL?.({ size: 128 }) })
          .setTitle(`File removed from message in #${channel?.name ?? 'unknown'}`)
          .setColor(0xf1c40f)
          .setDescription(`${newMessage.author ?? ''}`.trim() || null)
          .addFields({
            name: 'Removed',
            value: safeField(removed.slice(0, 25).map((a) => {
              const u = safeUrl(a.url);
              const n = a.name ?? 'file';
              return u ? `📎 [${n}](${u})` : `📎 ${n}`;
            }).join(' ')),
            inline: false,
          })
          .setFooter({ text: `User ID: ${newMessage.author?.id ?? 'unknown'}` })
          .setTimestamp();

        if (isImg) emb.setImage(url);

        
const row = jumpUrl
  ? new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(jumpUrl).setLabel('Jump'),
    )
  : null;

await sendLogEmbed(guild, emb, row ? { components: [row] } : {});
return;
      }

      // Normal edit
      if (!cfg.events.messageEdit) return;

      const oldText = contentOrPlaceholder(oldMessage);
      const newText = contentOrPlaceholder(newMessage);

      // Ignore embeds-only or no change
      if (oldText === newText) return;

      const isReply = Boolean(newMessage.reference?.messageId);

      const emb = new EmbedBuilder()
        .setAuthor({ name: `${newMessage.author?.tag ?? 'Unknown'}`, iconURL: newMessage.author?.displayAvatarURL?.({ size: 128 }) })
        .setTitle(`${isReply ? 'Reply edited' : 'Message edited'} in #${channel?.name ?? 'unknown'}`)
        .setColor(0xf1c40f)
        .addFields(
          { name: 'Old', value: safeField(oldText), inline: false },
          { name: 'New', value: safeField(newText), inline: false },
        )
        .setFooter({ text: `User ID: ${newMessage.author?.id ?? 'unknown'}` })
        .setTimestamp();

      
const row = jumpUrl
  ? new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(jumpUrl).setLabel('Jump'),
    )
  : null;

await sendLogEmbed(guild, emb, row ? { components: [row] } : {});
    } catch {}
  },
};
