const { Events, EmbedBuilder } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../utils/settings');
const { Debouncer } = require('../utils/debouncer');
const { metrics } = require('../utils/metrics');
const { dlock } = require('../app/distributedLock');

// Shared across both reaction-add and reaction-remove handlers.
// Keyed by `starboard:<guildId>:<msgId>` — 400 ms window handles rapid
// add/remove bursts (e.g. someone clicking ⭐ twice quickly).
const _debouncer = new Debouncer(400);

async function handleStar(reaction, user) {
  if (!reaction?.message?.guild) return;
  if (user?.bot) return;
  if (reaction.emoji?.name !== '⭐') return;

  const guild = reaction.message.guild;
  const debounceKey = `starboard:${guild.id}:${reaction.message.id}`;

  metrics.rate('events.starboard_reaction');
  _debouncer.schedule(debounceKey, () => processStarboard(reaction, guild));
}

async function processStarboard(reaction, guild) {
  // Re-fetch to get an accurate count after the debounce window.
  if (reaction.partial) await reaction.fetch().catch(() => {});
  const msg = reaction.message.partial
    ? await reaction.message.fetch().catch(() => null)
    : reaction.message;
  if (!msg) return;

  const settings = await getGuildSettings(guild.id);
  const sb = settings.starboard ?? {};
  if (!sb.enabled || !sb.channelId) return;
  const threshold = sb.threshold ?? 3;
  if (msg.channel.id === sb.channelId) return;

  const starReaction = msg.reactions.cache.get('⭐');
  const count = starReaction?.count ?? reaction.count ?? 0;

  // Serialise the settings read-modify-write so concurrent star events for
  // the same message don't create duplicate starboard posts.
  await dlock.run(`starboard-write:${guild.id}:${msg.id}`, async () => {
    const fresh = await getGuildSettings(guild.id);
    const map = fresh.starboardPosts ?? {};
    const sbCh = await guild.channels.fetch(sb.channelId).catch(() => null);

    if (count < threshold) {
      const starMsgId = map[msg.id];
      if (starMsgId) {
        if (sbCh?.isTextBased?.()) {
          const posted = await sbCh.messages.fetch(starMsgId).catch(() => null);
          if (posted) await posted.delete().catch(() => {});
        }
        delete map[msg.id];
        await setGuildSettings(guild.id, { starboardPosts: map });
      }
      return;
    }

    if (!sbCh?.isTextBased?.()) return;

    const emb = new EmbedBuilder()
      .setAuthor({ name: msg.author?.tag ?? 'Unknown', iconURL: msg.author?.displayAvatarURL?.() })
      .setDescription(msg.content?.slice(0, 4096) || '(no text)')
      .addFields({ name: 'Source', value: `[Jump to message](${msg.url})` })
      .setFooter({ text: `⭐ ${count} | #${msg.channel.name}` })
      .setTimestamp(msg.createdTimestamp);

    const firstImg = msg.attachments?.first?.();
    if (
      firstImg?.contentType?.startsWith('image/') ||
      /\.(png|jpe?g|gif|webp)$/i.test(firstImg?.url ?? '')
    ) {
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
  });
}

module.exports = {
  name: Events.MessageReactionAdd,
  // Export for reuse by the remove handler
  _debouncer,
  _processStarboard: processStarboard,
  async execute(client, reaction, user) {
    try { await handleStar(reaction, user); } catch {}
  },
};
