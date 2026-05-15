/**
 * diagnosticsSnapshot.js — full runtime state export for incident investigation.
 *
 * Captures a point-in-time snapshot of everything needed to diagnose
 * production issues without requiring shell access:
 *   - Process stats (memory, uptime, Node version)
 *   - Discord client state (guilds, latency, shard info)
 *   - Metrics snapshot (counters, gauges, rates)
 *   - Scheduler queue (pending job types and counts)
 *   - Safe mode state (disabled handlers)
 *   - Settings cache stats
 *   - Storage manifest summary
 *   - Recent error reporter config
 *
 * Usage:
 *   const { captureSnapshot } = require('./diagnosticsSnapshot');
 *   const snap = await captureSnapshot(client);
 *   // snap is a plain JSON-serialisable object
 */

const { metrics }           = require('../helpers/metrics');
const { scheduler }         = require('./durableScheduler');
const { getCacheStats }     = require('../stores/settings');
const { getCriticalNamespaces } = require('./storageManifest');
const { STORAGE_MANIFEST }  = require('./storageManifest');
const { ytDlpPool }         = require('../helpers/ytDlpPool');
const musicStateStore       = require('./musicStateStore');

/**
 * Capture a full diagnostics snapshot.
 * All errors are caught per-section — a broken section never blocks the rest.
 *
 * @param {import('discord.js').Client} client
 * @returns {Promise<object>}
 */
async function captureSnapshot(client) {
  const snap = {
    capturedAt:  new Date().toISOString(),
    capturedAtMs: Date.now(),
    sections:    {},
    errors:      [],
  };

  // ── 1. Process ─────────────────────────────────────────────────────────────
  try {
    const mem = process.memoryUsage();
    snap.sections.process = {
      pid:              process.pid,
      nodeVersion:      process.version,
      platform:         process.platform,
      arch:             process.arch,
      uptimeSeconds:    Math.floor(process.uptime()),
      memRssMb:         Math.round(mem.rss        / 1024 / 1024),
      memHeapUsedMb:    Math.round(mem.heapUsed   / 1024 / 1024),
      memHeapTotalMb:   Math.round(mem.heapTotal  / 1024 / 1024),
      memExternalMb:    Math.round(mem.external   / 1024 / 1024),
      cpuUser:          process.cpuUsage().user,
      cpuSystem:        process.cpuUsage().system,
      env:              process.env.NODE_ENV ?? 'unknown',
    };
  } catch (e) { snap.errors.push({ section: 'process', error: String(e) }); }

  // ── 2. Discord ─────────────────────────────────────────────────────────────
  try {
    snap.sections.discord = client ? {
      guilds:       client.guilds.cache.size,
      users:        client.users.cache.size,
      channels:     client.channels.cache.size,
      ping:         client.ws.ping,
      uptimeMs:     client.uptime ?? 0,
      readyAt:      client.readyAt?.toISOString() ?? null,
      shardCount:   client.shard?.count ?? 1,
      shardIds:     client.shard?.ids ?? [0],
      status:       client.ws.status,
    } : { available: false };
  } catch (e) { snap.errors.push({ section: 'discord', error: String(e) }); }

  // ── 3. Metrics ─────────────────────────────────────────────────────────────
  try {
    snap.sections.metrics = metrics.snapshot();
  } catch (e) { snap.errors.push({ section: 'metrics', error: String(e) }); }

  // ── 4. Scheduler ───────────────────────────────────────────────────────────
  try {
    const armed = scheduler._inProcess?.size ?? 0;
    // Count by job type from in-process map keys
    const jobTypes = {};
    if (scheduler._inProcess) {
      for (const key of scheduler._inProcess.keys()) {
        const type = key.split(':')[0] ?? 'unknown';
        jobTypes[type] = (jobTypes[type] ?? 0) + 1;
      }
    }
    snap.sections.scheduler = { armedJobs: armed, jobTypes };
  } catch (e) { snap.errors.push({ section: 'scheduler', error: String(e) }); }

  // ── 5. Settings cache ──────────────────────────────────────────────────────
  try {
    snap.sections.settingsCache = getCacheStats();
  } catch (e) { snap.errors.push({ section: 'settingsCache', error: String(e) }); }

  // ── 6. Storage manifest ────────────────────────────────────────────────────
  try {
    snap.sections.storage = {
      totalNamespaces:    STORAGE_MANIFEST.length,
      criticalNamespaces: getCriticalNamespaces().map((n) => n.prefix),
    };
  } catch (e) { snap.errors.push({ section: 'storage', error: String(e) }); }

  // ── 7. Music / yt-dlp pool ────────────────────────────────────────────────
  try {
    snap.sections.music = {
      ytdlpPool:    ytDlpPool.stats(),
      activeGuilds: musicStateStore.listActiveGuilds().length,
    };
  } catch (e) { snap.errors.push({ section: 'music', error: String(e) }); }

  return snap;
}

/**
 * Run a canary health check — returns { healthy: boolean, checks: object[] }.
 * Used by /dev reliability canary and the HTTP /health endpoint.
 *
 * @param {import('discord.js').Client} client
 */
async function runCanaryChecks(client) {
  const checks = [];

  // Check 1: Discord WS ping reasonable
  try {
    const ping = client?.ws?.ping ?? -1;
    checks.push({
      name:    'discord_ping',
      healthy: ping >= 0 && ping < 500,
      value:   `${ping}ms`,
      message: ping < 0 ? 'Client not connected' : ping >= 500 ? `High latency: ${ping}ms` : `OK (${ping}ms)`,
    });
  } catch (e) { checks.push({ name: 'discord_ping', healthy: false, message: String(e) }); }

  // Check 2: Memory heap not over 90%
  try {
    const mem  = process.memoryUsage();
    const pct  = mem.heapUsed / mem.heapTotal;
    checks.push({
      name:    'memory_heap',
      healthy: pct < 0.90,
      value:   `${Math.round(pct * 100)}%`,
      message: pct >= 0.90 ? `Heap at ${Math.round(pct * 100)}% — GC pressure likely` : `OK (${Math.round(pct * 100)}%)`,
    });
  } catch (e) { checks.push({ name: 'memory_heap', healthy: false, message: String(e) }); }

  // Check 3: Scheduler not stalled (armed count not absurdly high)
  try {
    const armed = scheduler._inProcess?.size ?? 0;
    checks.push({
      name:    'scheduler_queue',
      healthy: armed < 1000,
      value:   String(armed),
      message: armed >= 1000 ? `Scheduler queue may be backed up (${armed} armed)` : `OK (${armed} armed)`,
    });
  } catch (e) { checks.push({ name: 'scheduler_queue', healthy: false, message: String(e) }); }

  // Check 4: dlock timeout rate not spiking
  try {
    const timeouts  = metrics.getCounter('dlock.timeout')  ?? 0;
    const acquired  = metrics.getCounter('dlock.acquired') ?? 0;
    const ratio     = acquired > 0 ? timeouts / acquired : 0;
    checks.push({
      name:    'dlock_health',
      healthy: ratio < 0.10,
      value:   `${Math.round(ratio * 100)}% timeout rate`,
      message: ratio >= 0.10 ? `High dlock timeout rate (${Math.round(ratio * 100)}%)` : `OK`,
    });
  } catch (e) { checks.push({ name: 'dlock_health', healthy: false, message: String(e) }); }

  // Check 5: Scheduler job drop rate
  try {
    const dropped   = metrics.getCounter('scheduler.jobs.dropped')   ?? 0;
    const completed = metrics.getCounter('scheduler.jobs.completed') ?? 0;
    const total     = dropped + completed;
    const dropRate  = total > 0 ? dropped / total : 0;
    checks.push({
      name:    'scheduler_drop_rate',
      healthy: dropRate < 0.05,
      value:   `${Math.round(dropRate * 100)}%`,
      message: dropRate >= 0.05 ? `Jobs being dropped (${Math.round(dropRate * 100)}% drop rate)` : `OK`,
    });
  } catch (e) { checks.push({ name: 'scheduler_drop_rate', healthy: false, message: String(e) }); }

  const healthy = checks.every((c) => c.healthy);
  return { healthy, checks };
}

module.exports = { captureSnapshot, runCanaryChecks };
