const { ActivityType } = require('discord.js');
const { logger } = require('./logger');

/**
 * Rotates the bot presence every N ms.
 * Defaults:
 *  - interval: 10000ms
 *  - text: "!help or /help to see commands"
 *  - streaming url: https://twitch.tv/discord (override with STREAM_URL)
 */
function startActivityRotation(client) {
  // Default 30 s — 10 s fires too frequently and burns cycles on idle bots.
  // Override with ACTIVITY_ROTATE_MS env var.
  const intervalMs = Number(process.env.ACTIVITY_ROTATE_MS || 30_000);
  const text = String(process.env.ACTIVITY_TEXT || '!help or /help to see commands');
  const streamUrl = String(process.env.STREAM_URL || 'https://twitch.tv/discord');

  const activities = [
    { type: ActivityType.Watching, name: text },
    { type: ActivityType.Listening, name: text },
    { type: ActivityType.Streaming, name: text, url: streamUrl },
  ];

  let i = 0;

  const apply = async () => {
    if (!client.user) return;
    const a = activities[i % activities.length];
    i += 1;

    try {
      // For Streaming activity, Discord requires a URL
      const payload = { activities: [a], status: 'online' };
      await client.user.setPresence(payload);
    } catch (err) {
      logger.debug({ err }, 'Failed to set presence');
    }
  };

  // Set immediately, then rotate
  apply();
  const t = setInterval(apply, intervalMs);
  // Don't keep the process alive because of the timer
  t.unref?.();

  // Store for potential cleanup
  client._presenceRotationTimer = t;

  logger.info({ intervalMs, text }, 'Presence rotation enabled');
}

module.exports = { startActivityRotation };
