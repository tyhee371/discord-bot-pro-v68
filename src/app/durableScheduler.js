/**
 * durableScheduler.js — persisted, restart-safe job scheduler.
 *
 * Replaces raw setTimeout for all timed bot operations (giveaway ends,
 * prison releases, ticket claim timeouts). Jobs are written to the DB
 * before they fire, so a restart never silently drops a pending action.
 *
 * Architecture
 * ────────────
 *   - Each job is stored as: scheduler:job:<jobId>  → JobRecord
 *   - A guild index maps:    scheduler:idx:<guildId> → string[] of jobIds
 *   - On startup, call scheduler.rehydrate(client) to replay all due/pending jobs.
 *   - In-process: an interval tick fires every TICK_MS to run overdue jobs.
 *
 * JobRecord shape:
 *   { id, guildId, type, payload, runAt, createdAt, attempts }
 *
 * Usage:
 *   const { scheduler } = require('./durableScheduler');
 *
 *   // Schedule a job
 *   await scheduler.schedule({
 *     guildId: 'guildId',
 *     type: 'giveaway:end',
 *     payload: { messageId: '...', channelId: '...' },
 *     runAt: Date.now() + 60_000,
 *   });
 *
 *   // Cancel a job
 *   await scheduler.cancel(jobId);
 *
 *   // Register a handler (call at bot startup, before rehydrate)
 *   scheduler.register('giveaway:end', async (job, client) => { ... });
 *
 *   // Rehydrate on startup
 *   await scheduler.rehydrate(client);
 */

const { db } = require('../db');
const { logger } = require('../helpers/logger');
const { metrics } = require('../helpers/metrics');
const { AsyncLock } = require('../helpers/asyncLock');

const JOB_KEY     = (id)      => `scheduler:job:${id}`;
const IDX_KEY     = (guildId) => `scheduler:idx:${guildId}`;
const GLOBAL_IDX  = 'scheduler:global_idx';

const TICK_MS        = 5_000;   // check for due jobs every 5 s
const MAX_ATTEMPTS   = 3;
const RETRY_DELAY_MS = 30_000;  // 30 s backoff on failure

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

class DurableScheduler {
  constructor() {
    /** @type {Map<string, (job: object, client: object) => Promise<void>>} */
    this._handlers  = new Map();
    /** @type {Map<string, ReturnType<typeof setTimeout>>} */
    this._inProcess = new Map();    // jobId → local setTimeout handle
    this._lock      = new AsyncLock();
    this._client    = null;
    this._tickTimer = null;
  }

  // ── Registration ────────────────────────────────────────────────────────────

  /**
   * Register a handler for a job type.
   * Must be called before rehydrate().
   * @param {string}   type
   * @param {Function} fn   async (job, client) => void
   */
  register(type, fn) {
    this._handlers.set(type, fn);
  }

  // ── Scheduling ──────────────────────────────────────────────────────────────

  /**
   * Persist and schedule a new job.
   * @param {{ guildId: string, type: string, payload: object, runAt: number, id?: string }} opts
   * @returns {Promise<string>} jobId
   */
  async schedule({ guildId, type, payload, runAt, id }) {
    const jobId = id ?? makeId();
    const job = {
      id: jobId,
      guildId,
      type,
      payload: payload ?? {},
      runAt,
      createdAt: Date.now(),
      attempts: 0,
    };

    await db.set(JOB_KEY(jobId), JSON.stringify(job));
    await this._addToIndex(guildId, jobId);
    await this._addToGlobalIndex(jobId);
    this._arm(job);

    metrics.increment('scheduler.jobs.scheduled', { type });
    logger.debug({ jobId, type, guildId, runAt }, '[scheduler] job scheduled');
    return jobId;
  }

  /**
   * Cancel a pending job by ID.
   * @param {string} jobId
   */
  async cancel(jobId) {
    const raw = await db.get(JOB_KEY(jobId));
    if (raw) {
      const job = JSON.parse(raw);
      await db.delete(JOB_KEY(jobId));
      await this._removeFromIndex(job.guildId, jobId);
      await this._removeFromGlobalIndex(jobId);
      metrics.increment('scheduler.jobs.cancelled', { type: job.type });
    }
    const handle = this._inProcess.get(jobId);
    if (handle !== undefined) {
      clearTimeout(handle);
      this._inProcess.delete(jobId);
    }
  }

  /**
   * Get a job record by ID (null if not found).
   * @param {string} jobId
   * @returns {Promise<object|null>}
   */
  async get(jobId) {
    try {
      const raw = await db.get(JOB_KEY(jobId));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  /**
   * List all pending job IDs for a guild.
   * @param {string} guildId
   * @returns {Promise<string[]>}
   */
  async listForGuild(guildId) {
    try {
      const raw = await db.get(IDX_KEY(guildId));
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  // ── Startup rehydration ─────────────────────────────────────────────────────

  /**
   * Reload all persisted jobs on startup and arm them.
   * Jobs that are already overdue are fired immediately (with a short stagger
   * so the bot has time to fully connect before handlers run).
   *
   * @param {import('discord.js').Client} client
   */
  async rehydrate(client) {
    this._client = client;
    let restored = 0;
    let fired    = 0;

    try {
      const rawIdx = await db.get(GLOBAL_IDX);
      const allIds = rawIdx ? JSON.parse(rawIdx) : [];

      for (const jobId of allIds) {
        const raw = await db.get(JOB_KEY(jobId));
        if (!raw) {
          await this._removeFromGlobalIndex(jobId);
          continue;
        }
        const job = JSON.parse(raw);
        if (job.attempts >= MAX_ATTEMPTS) {
          logger.warn({ jobId: job.id, type: job.type }, '[scheduler] job exceeded max attempts, dropping');
          await this.cancel(job.id);
          continue;
        }
        restored++;
        this._arm(job, true);
      }

      metrics.gauge('scheduler.jobs.restored', restored);
      logger.info({ restored, fired }, '[scheduler] rehydration complete');
    } catch (err) {
      logger.error({ err }, '[scheduler] rehydration failed');
    }

    this._startTick();
    return restored;
  }

  /**
   * Graceful shutdown — cancel all in-process timers and stop the tick.
   */
  shutdown() {
    if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; }
    for (const handle of this._inProcess.values()) clearTimeout(handle);
    this._inProcess.clear();
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  /**
   * Arm a job with a local setTimeout.
   * If the job is already overdue the delay is a small random stagger
   * (avoids thundering herd on restart).
   */
  _arm(job, isRehydrating = false) {
    if (this._inProcess.has(job.id)) return; // already armed

    const remaining = Math.max(0, job.runAt - Date.now());
    // Add jitter only for already-overdue jobs on rehydration (thundering herd prevention).
    // Jobs that are still in the future fire at their scheduled time with no jitter.
    const delay = isRehydrating && remaining === 0
      ? Math.floor(Math.random() * 2000)
      : remaining;

    const handle = setTimeout(() => {
      this._inProcess.delete(job.id);
      this._execute(job).catch(() => {});
    }, delay);

    this._inProcess.set(job.id, handle);
  }

  async _execute(job) {
    return this._lock.run(`exec:${job.id}`, async () => {
      // Re-fetch to ensure it's still pending (could have been cancelled)
      const raw = await db.get(JOB_KEY(job.id));
      if (!raw) return; // was cancelled

      const current = JSON.parse(raw);
      const handler = this._handlers.get(current.type);

      if (!handler) {
        logger.warn({ type: current.type, jobId: current.id }, '[scheduler] no handler registered for type');
        await this.cancel(current.id);
        return;
      }

      try {
        await handler(current, this._client);
        // Success — remove from DB
        await db.delete(JOB_KEY(current.id));
        await this._removeFromIndex(current.guildId, current.id);
        await this._removeFromGlobalIndex(current.id);
        metrics.increment('scheduler.jobs.completed', { type: current.type });
        logger.debug({ jobId: current.id, type: current.type }, '[scheduler] job completed');
      } catch (err) {
        const attempts = (current.attempts ?? 0) + 1;
        metrics.increment('scheduler.jobs.failed', { type: current.type });
        logger.warn({ err, jobId: current.id, type: current.type, attempts }, '[scheduler] job failed');

        if (attempts >= MAX_ATTEMPTS) {
          logger.error({ jobId: current.id, type: current.type }, '[scheduler] job exceeded max attempts, dropping');
          await db.delete(JOB_KEY(current.id));
          await this._removeFromIndex(current.guildId, current.id);
          await this._removeFromGlobalIndex(current.id);
          metrics.increment('scheduler.jobs.dropped', { type: current.type });
        } else {
          // Persist updated attempt count and retry
          const updated = { ...current, attempts, runAt: Date.now() + RETRY_DELAY_MS };
          await db.set(JOB_KEY(current.id), JSON.stringify(updated));
          this._arm(updated);
        }
      }
    });
  }

  /** Periodic tick — catches any jobs whose setTimeout was somehow missed. */
  _startTick() {
    if (this._tickTimer) return;
    this._tickTimer = setInterval(async () => {
      try {
        const rawIdx = await db.get(GLOBAL_IDX);
        const allIds = rawIdx ? JSON.parse(rawIdx) : [];
        const now = Date.now();
        for (const jobId of allIds) {
          if (this._inProcess.has(jobId)) continue; // already armed
          const raw = await db.get(JOB_KEY(jobId));
          if (!raw) { await this._removeFromGlobalIndex(jobId); continue; }
          const job = JSON.parse(raw);
          if (job.runAt <= now + TICK_MS) this._arm(job);
        }
      } catch {}
    }, TICK_MS);
    this._tickTimer.unref?.(); // don't keep process alive
  }

  // ── Index helpers ───────────────────────────────────────────────────────────

  async _addToIndex(guildId, jobId) {
    return this._lock.run(IDX_KEY(guildId), async () => {
      const raw = await db.get(IDX_KEY(guildId));
      const ids = raw ? JSON.parse(raw) : [];
      if (!ids.includes(jobId)) ids.push(jobId);
      await db.set(IDX_KEY(guildId), JSON.stringify(ids));
    });
  }

  async _removeFromIndex(guildId, jobId) {
    return this._lock.run(IDX_KEY(guildId), async () => {
      try {
        const raw = await db.get(IDX_KEY(guildId));
        if (!raw) return;
        const ids = JSON.parse(raw).filter((id) => id !== jobId);
        await db.set(IDX_KEY(guildId), JSON.stringify(ids));
      } catch {}
    });
  }

  async _addToGlobalIndex(jobId) {
    return this._lock.run(GLOBAL_IDX, async () => {
      const raw = await db.get(GLOBAL_IDX);
      const ids = raw ? JSON.parse(raw) : [];
      if (!ids.includes(jobId)) ids.push(jobId);
      await db.set(GLOBAL_IDX, JSON.stringify(ids));
    });
  }

  async _removeFromGlobalIndex(jobId) {
    return this._lock.run(GLOBAL_IDX, async () => {
      try {
        const raw = await db.get(GLOBAL_IDX);
        if (!raw) return;
        const ids = JSON.parse(raw).filter((id) => id !== jobId);
        await db.set(GLOBAL_IDX, JSON.stringify(ids));
      } catch {}
    });
  }
}

/** Global singleton. */
const scheduler = new DurableScheduler();

module.exports = { DurableScheduler, scheduler };
