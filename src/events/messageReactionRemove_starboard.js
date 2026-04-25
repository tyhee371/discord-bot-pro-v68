const { Events, EmbedBuilder } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../utils/settings');

async function handleStar(reaction, user) {
  if (!reaction?.message?.guild) return;
  if (user?.bot) return;

  const guild = reaction.message.guild;
  const settings = await getGuildSettings(guild.id);
  const sb = settings.starboard ?? {};
  if (!sb.enabled || !sb.channelId) return;
  const threshold = sb.threshold ?? 3;

  if (reaction.emoji?.name !== '⭐') return;

  if (reaction.partial) await reaction.fetch().catch(() => {});
  const msg = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!msg) return;

  if (msg.channel.id === sb.channelId) return;

  const starReaction = msg.reactions.cache.get('⭐');
  const count = starReaction?.count ?? reaction.count ?? 0;

  const map = settings.starboardPosts ?? {};
  if (count < threshold) {
    const starMsgId = map[msg.id];
    if (starMsgId) {
      const sbCh = await guild.channels.fetch(sb.channelId).catch(() => null);
      if (sbCh?.isTextBased?.()) {
        const posted = await sbCh.messages.fetch(starMsgId).catch(() => null);
        if (posted) await posted.delete().catch(() => {});
      }
      delete map[msg.id];
      await setGuildSettings(guild.id, { starboardPosts: map });
    }
    return;
  }

  const sbCh = await guild.channels.fetch(sb.channelId).catch(() => null);
  if (!sbCh?.isTextBased?.()) return;

  const emb = new EmbedBuilder()
    .setAuthor({ name: msg.author?.tag ?? 'Unknown', iconURL: msg.author?.displayAvatarURL?.() })
    .setDescription(msg.content?.slice(0, 4096) || '(no text)')
    .addFields({ name: 'Source', value: `[Jump to message](${msg.url})` })
    .setFooter({ text: `⭐ ${count} | #${msg.channel.name}` })
    .setTimestamp(msg.createdTimestamp);

  const firstImg = msg.attachments?.first?.();
  if (firstImg?.contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(firstImg?.url ?? '')) {
    emb.setImage(firstImg.url);
  }

  const existing = map[msg.id];
  if (existing) {
    const posted = await sbCh.messages.fetch(existing).catch(() => null);
    if (posted) {
      await posted.edit({ embeds: [emb] }).catch(() => {});
      return;
    }
  }

  const posted = await sbCh.send({ content: '⭐ Starred message', embeds: [emb] }).catch(() => null);
  if (!posted) return;
  map[msg.id] = posted.id;
  await setGuildSettings(guild.id, { starboardPosts: map });
}

module.exports = {
  name: Events.MessageReactionRemove,
  async execute(client, reaction, user) {
    try { await handleStar(reaction, user); } catch {}
  },
};
