/**
 * shard.js — ShardingManager entry point (Phase 4)
 *
 * Use this instead of src/index.js when running at scale (100+ guilds).
 * discord.js requires a single "spawner" process that manages shard child
 * processes.  Each shard runs src/index.js and handles a slice of guilds.
 *
 * Usage:
 *   node src/shard.js              # auto-shard count (recommended)
 *   SHARD_COUNT=4 node src/shard.js  # manual shard count
 *
 * When to shard:
 *   Discord enforces sharding once a bot reaches 2500 guilds.  In practice
 *   you will want to shard around 500–1000 guilds if using GuildPresences,
 *   GuildVoiceStates, or heavy gateway traffic.
 *
 * Music state (Phase 3 update):
 *   Serializable music state (queue, volume, 24/7 mode, loop mode) is now
 *   persisted to Redis via src/services/musicStateStore.js. State survives
 *   restarts and is accessible across shards for read purposes.
 *   Non-serializable state (AudioPlayer, VoiceConnection, timers) still
 *   lives in each shard's process memory — this is unavoidable as these
 *   objects cannot be serialized. Each shard handles its own audio pipeline.
 *   Discord's default 'auto' sharding maps each guild to exactly one shard,
 *   so in practice each guild's music state is owned by exactly one process.
 *
 * Environment variables:
 *   SHARD_COUNT     - number of shards (default: 'auto')
 *   SHARD_DELAY_MS  - ms between shard spawns (default: 5500)
 *   HEALTH_PORT     - base health-check port; each shard uses PORT + shardId
 */

require('events').defaultMaxListeners = 50;

const path = require('node:path');
const { ShardingManager } = require('discord.js');

// Pino logger is not available before shards start — use console here.
const log = {
  info:  (...a) => console.log('[SHARD-MGR]', ...a),
  warn:  (...a) => console.warn('[SHARD-MGR]', ...a),
  error: (...a) => console.error('[SHARD-MGR]', ...a),
};

const shardCount = process.env.SHARD_COUNT
  ? Number(process.env.SHARD_COUNT)
  : 'auto';

const spawnDelay = Number(process.env.SHARD_DELAY_MS || 5500);

const token = process.env.DISCORD_TOKEN;
if (!token) {
  log.error('DISCORD_TOKEN is not set. Exiting.');
  process.exit(1);
}

const manager = new ShardingManager(path.join(__dirname, 'index.js'), {
  token,
  totalShards: shardCount,
  shardArgs: [],
  execArgv: ['--dns-result-order=ipv4first'],
  respawn: true,
});

manager.on('shardCreate', (shard) => {
  log.info(`Shard ${shard.id} created`);

  shard.on('ready', () => {
    log.info(`Shard ${shard.id} ready`);
  });

  shard.on('disconnect', () => {
    log.warn(`Shard ${shard.id} disconnected`);
  });

  shard.on('reconnecting', () => {
    log.info(`Shard ${shard.id} reconnecting`);
  });

  shard.on('death', (process) => {
    log.error(`Shard ${shard.id} died (pid ${process.pid}) — manager will respawn`);
  });

  shard.on('error', (err) => {
    log.error(`Shard ${shard.id} error:`, err.message);
  });
});

manager.spawn({ delay: spawnDelay, timeout: 30_000 })
  .then(() => {
    log.info(`All shards spawned (count: ${manager.totalShards})`);
  })
  .catch((err) => {
    log.error('Failed to spawn shards:', err.message);
    process.exit(1);
  });

process.on('SIGINT',  () => { log.info('SIGINT received — shutting down manager'); process.exit(0); });
process.on('SIGTERM', () => { log.info('SIGTERM received — shutting down manager'); process.exit(0); });
