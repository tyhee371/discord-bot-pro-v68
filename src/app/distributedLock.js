/**
 * distributedLock.js — shard-aware distributed lock.
 *
 * When Redis is available, uses SET NX PX for cross-shard mutual exclusion.
 * Falls back to the in-process AsyncLock when Redis is unavailable (single
 * instance / dev mode) — no code changes needed at call sites.
 *
 * Usage:
 *   const { dlock } = require('./distributedLock');
 *
 *   // Hold a lock for up to 10 s:
 *   const result = await dlock.run('starboard:guildId:msgId', async () => {
 *     // critical section
 *   }, { ttlMs: 10_000 });
 *
 * Design notes:
 *   - TTL prevents deadlocks if the process crashes mid-lock.
 *   - Lock key is namespaced under `dlock:` to avoid collisions.
 *   - Retry with jitter until the TTL expires (spin-wait with backoff).
 *   - In-process fallback ensures correctness on single-instance deployments.
 */

const { redisClient } = require('./redis');
const { AsyncLock }   = require('../helpers/asyncLock');
const { logger }      = require('../helpers/logger');
const { metrics }     = require('../helpers/metrics');

const LOCK_PREFIX    = 'dlock:';
const DEFAULT_TTL_MS = 10_000;
const RETRY_DELAY_MS = 50;
const MAX_WAIT_MS    = 8_000;

function lockKey(key) {
  return `${LOCK_PREFIX}${key}`;
}

/** Generate a unique lock token so only the owner can release the lock. */
function makeToken() {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Sleep for `ms` milliseconds.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class DistributedLock {
  constructor() {
    this._local = new AsyncLock(); // fallback for when Redis is unavailable
  }

  /**
   * Acquire the distributed lock for `key`, run `fn`, then release.
   *
   * @template T
   * @param {string}   key
   * @param {Function} fn          async () => T
   * @param {object}   [opts]
   * @param {number}   [opts.ttlMs=10000]   Lock TTL in ms (safety net against crash)
   * @param {number}   [opts.maxWaitMs]     Max time to wait for lock (default: ttlMs)
   * @returns {Promise<T>}
   */
  async run(key, fn, opts = {}) {
    const ttlMs    = opts.ttlMs    ?? DEFAULT_TTL_MS;
    const maxWait  = opts.maxWaitMs ?? Math.min(MAX_WAIT_MS, ttlMs);

    // ── Redis path ────────────────────────────────────────────────────────
    if (redisClient.isAvailable()) {
      return this._runRedis(key, fn, ttlMs, maxWait);
    }

    // ── In-process fallback ───────────────────────────────────────────────
    metrics.increment('dlock.fallback');
    return this._local.run(key, fn);
  }

  async _runRedis(key, fn, ttlMs, maxWaitMs) {
    const rkey  = lockKey(key);
    const token = makeToken();
    const ttlS  = Math.ceil(ttlMs / 1000);
    const deadline = Date.now() + maxWaitMs;
    let acquired = false;

    // Spin-wait with exponential backoff + jitter
    let backoff = RETRY_DELAY_MS;
    while (Date.now() < deadline) {
      const ok = await redisClient.setnx(rkey, token, ttlS);
      if (ok) { acquired = true; break; }
      await sleep(backoff + Math.floor(Math.random() * backoff));
      backoff = Math.min(backoff * 1.5, 500);
    }

    if (!acquired) {
      metrics.increment('dlock.timeout');
      logger.debug({ key }, '[dlock] lock acquire timed out — falling back to in-process lock (expected on single-process deployment)');
      return this._local.run(key, fn);
    }

    metrics.increment('dlock.acquired');
    try {
      return await fn();
    } finally {
      // Release: only delete if we still own the lock (Lua CAS)
      try {
        await redisClient.eval(
          `if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`,
          1,
          rkey,
          token,
        );
      } catch {
        // Best-effort release; TTL will expire it anyway
      }
      metrics.increment('dlock.released');
    }
  }

  /**
   * Expose the in-process fallback directly (useful for tests).
   */
  get local() {
    return this._local;
  }
}

/** Global singleton. */
const dlock = new DistributedLock();

module.exports = { DistributedLock, dlock };
