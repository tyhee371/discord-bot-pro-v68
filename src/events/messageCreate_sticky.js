const { Events } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../utils/settings');
const { Debouncer } = require('../utils/debouncer');
const { metrics } = require('../utils/metrics');
const { dlock } = require('../app/distributedLock');

// Debounce sticky reposts per channel — 1 s window absorbs message bursts
// (e.g. spam, bot responses) so we only repost the sticky once per burst
// instead of on every single message.
const _debouncer = new Debouncer(1000);

module.exports = {
  name: Events.MessageCreate,
  async execute(client, message) {
    try {
      if (!message.guild || message.author?.bot) return;

      // Quick pre-check: bail early without a settings fetch if not likely sticky
      const debounceKey = `sticky:${message.guild.id}:${message.channel.id}`;

      metrics.rate('events.sticky_trigger');
      _debouncer.schedule(debounceKey, () =>
        processSticky(message.guild, message.channel, message.author?.id),
      );
    } catch {
      // ignore
    }
  },
};

async function processSticky(guild, channel, triggeringAuthorId) {
  // Serialise per channel so two simultaneous triggers don't double-post.
  // ttlMs=2000: sticky write (fetch+delete+send) takes <500ms — 2s is generous
  // maxWaitMs=1500: if another write holds the lock, skip rather than queue up.
  // Sticky messages are best-effort; missing one trigger is fine.
  await dlock.run(`sticky-write:${guild.id}:${channel.id}`, async () => {
    const settings = await getGuildSettings(guild.id);
    const sticky = settings.sticky ?? {};
    const cfg = sticky[channel.id];
    if (!cfg?.message) return;

    // delete previous sticky if still present
    if (cfg.lastMessageId) {
      const prev = await channel.messages.fetch(cfg.lastMessageId).catch(() => null);
      if (prev) await prev.delete().catch(() => {});
    }

    const sent = await channel.send({ content: cfg.message }).catch(() => null);
    if (!sent) return;

    sticky[channel.id] = { ...cfg, lastMessageId: sent.id };
    await setGuildSettings(guild.id, { sticky });
  }, { ttlMs: 2000, maxWaitMs: 1500 });
}
