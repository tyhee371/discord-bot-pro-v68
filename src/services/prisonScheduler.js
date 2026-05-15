const { getAll, replaceAll } = require('./prisonService');

/**
 * Periodically removes the configured "prison" role when its timer expires.
 * Timers are stored per guild in the DB so they survive restarts.
 */
function startPrisonScheduler(client, { intervalMs = 10_000 } = {}) {
  if (!client) throw new Error('startPrisonScheduler requires a Discord client');

  setInterval(async () => {
    const now = Date.now();

    for (const [guildId, guild] of client.guilds.cache) {
      let timers;
      try {
        timers = await getAll(guildId);
      } catch {
        continue;
      }

      const nextTimers = { ...timers };
      let changed = false;

      for (const [userId, data] of Object.entries(timers)) {
        if (!data || typeof data.removeAt !== 'number' || !data.roleId) {
          delete nextTimers[userId];
          changed = true;
          continue;
        }

        if (data.removeAt > now) continue;

        try {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (member && member.roles.cache.has(data.roleId)) {
            await member.roles.remove(data.roleId, 'Prison timer expired').catch(() => {});
          }
        } catch {
          // ignore
        }

        delete nextTimers[userId];
        changed = true;
      }

      if (changed) {
        await replaceAll(guildId, nextTimers).catch(() => {});
      }
    }
  }, intervalMs);
}

module.exports = { startPrisonScheduler };
