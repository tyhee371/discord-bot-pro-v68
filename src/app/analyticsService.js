/**
 * analyticsService.js — bot-wide analytics aggregator.
 *
 * Produces a rich snapshot consumed by /dev analytics and the /metrics
 * HTTP endpoint. Combines:
 *   - In-process metrics (counters, gauges, rates)
 *   - Scheduler queue depth
 *   - Per-guild moderation activity
 *   - Memory / process health
 *   - Discord client stats
 *
 * Usage:
 *   const { buildAnalyticsSnapshot } = require('./analyticsService');
 *   const snap = await buildAnalyticsSnapshot(client);
 */

const { metrics } = require('../helpers/metrics');
const { scheduler } = require('./durableScheduler');
const { logger } = require('../helpers/logger');
const { databaseClient } = require('./database');

/**
 * Build a full analytics snapshot.
 * @param {import('discord.js').Client} client
 * @returns {Promise<object>}
 */
async function buildAnalyticsSnapshot(client) {
  const snap = metrics.snapshot();
  const mem  = process.memoryUsage();

  const discord = client ? {
    guilds:       client.guilds.cache.size,
    users:        client.users.cache.size,
    channels:     client.channels.cache.size,
    ping:         client.ws.ping,
    uptimeMs:     client.uptime ?? 0,
    shardCount:   client.shard?.count ?? 1,
    shardIds:     client.shard?.ids ?? [0],
  } : null;

  const process_ = {
    uptimeSeconds: Math.floor(process.uptime()),
    pid:           process.pid,
    nodeVersion:   process.version,
    memRssMb:      Math.round(mem.rss        / 1024 / 1024),
    memHeapUsedMb: Math.round(mem.heapUsed   / 1024 / 1024),
    memHeapTotalMb:Math.round(mem.heapTotal  / 1024 / 1024),
    memExternalMb: Math.round(mem.external   / 1024 / 1024),
  };

  const schedulerStats = {
    armedJobs:  scheduler._inProcess?.size ?? 0,
  };

  // Phase 5: PostgreSQL stats (only when connected)
  let dbStats = null;
  if (databaseClient.isAvailable()) {
    dbStats = await databaseClient.getStats().catch(() => null);
  }

  // Top-level command rates from metrics
  const commandRates = {
    slashPerMin:  snap.rates['commands.slash']  ?? 0,
    prefixPerMin: snap.rates['commands.prefix'] ?? 0,
  };

  // Top event rates
  const eventRates = {
    starboardPerMin: snap.rates['events.starboard_reaction'] ?? 0,
    stickyPerMin:    snap.rates['events.sticky_trigger']     ?? 0,
    voicePerMin:     snap.rates['events.voice_state']        ?? 0,
    musicPlayPerMin: snap.rates['music.play_request']        ?? 0,
  };

  // Key counters
  const counters = {
    commandsExecuted: snap.counters['commands.executed'] ?? 0,
    settingsCacheHits:   snap.counters['settings.cache.hit']  ?? 0,
    settingsCacheMisses: snap.counters['settings.cache.miss'] ?? 0,
    settingsWrites:      snap.counters['settings.writes']     ?? 0,
    schedulerCompleted:  snap.counters['scheduler.jobs.completed'] ?? 0,
    schedulerFailed:     snap.counters['scheduler.jobs.failed']    ?? 0,
    schedulerDropped:    snap.counters['scheduler.jobs.dropped']   ?? 0,
    dlockAcquired:       snap.counters['dlock.acquired']  ?? 0,
    dlockTimeout:        snap.counters['dlock.timeout']   ?? 0,
    dlockFallback:       snap.counters['dlock.fallback']  ?? 0,
  };

  // Gauges
  const gauges = {
    musicOpQueueDepth: snap.gauges['music.op_queue.depth'] ?? 0,
  };

  return {
    generatedAt:   Date.now(),
    discord,
    process:       process_,
    scheduler:     schedulerStats,
    commandRates,
    eventRates,
    counters,
    gauges,
    rawMetrics:    snap,
  };
}

/**
 * Format an analytics snapshot as Discord embed fields.
 * @param {object} snap  Result of buildAnalyticsSnapshot()
 * @returns {import('discord.js').EmbedField[]}
 */
function formatSnapshotFields(snap) {
  const { discord, process: proc, scheduler: sched, commandRates, eventRates, counters } = snap;

  const fields = [];

  if (discord) {
    fields.push({
      name: '🤖 Discord',
      value: [
        `Guilds: **${discord.guilds}** | Users: **${discord.users}**`,
        `Ping: **${discord.ping}ms** | Shards: **${discord.shardCount}**`,
        `Uptime: **${fmtUptime(discord.uptimeMs)}**`,
      ].join('\n'),
      inline: true,
    });
  }

  fields.push({
    name: '🖥️ Process',
    value: [
      `Uptime: **${fmtUptime(proc.uptimeSeconds * 1000)}**`,
      `Heap: **${proc.memHeapUsedMb}**/**${proc.memHeapTotalMb}** MB`,
      `RSS: **${proc.memRssMb}** MB`,
    ].join('\n'),
    inline: true,
  });

  fields.push({
    name: '⏱️ Command Rates (per min)',
    value: [
      `Slash: **${commandRates.slashPerMin}**`,
      `Prefix: **${commandRates.prefixPerMin}**`,
    ].join('\n'),
    inline: true,
  });

  fields.push({
    name: '📡 Event Rates (per min)',
    value: [
      `Starboard: **${eventRates.starboardPerMin}**`,
      `Sticky: **${eventRates.stickyPerMin}**`,
      `Voice: **${eventRates.voicePerMin}**`,
      `Music plays: **${eventRates.musicPlayPerMin}**`,
    ].join('\n'),
    inline: true,
  });

  fields.push({
    name: '🗄️ Settings Cache',
    value: [
      `Hits: **${counters.settingsCacheHits}**`,
      `Misses: **${counters.settingsCacheMisses}**`,
      `Writes: **${counters.settingsWrites}**`,
    ].join('\n'),
    inline: true,
  });

  fields.push({
    name: '📅 Scheduler',
    value: [
      `Armed: **${sched.armedJobs}**`,
      `Completed: **${counters.schedulerCompleted}**`,
      `Failed: **${counters.schedulerFailed}**`,
      `Dropped: **${counters.schedulerDropped}**`,
    ].join('\n'),
    inline: true,
  });

  fields.push({
    name: '🔐 Distributed Lock',
    value: [
      `Acquired: **${counters.dlockAcquired}**`,
      `Timeouts: **${counters.dlockTimeout}**`,
      `Fallbacks: **${counters.dlockFallback}**`,
    ].join('\n'),
    inline: true,
  });

  return fields;
}

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

module.exports = { buildAnalyticsSnapshot, formatSnapshotFields };
