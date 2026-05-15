/**
 * ytDlpPool.js — yt-dlp concurrency limiter (Phase 4)
 *
 * Problem: Every track request spawns a fresh yt-dlp child process (~200–500ms
 * startup, ~50MB RAM each).  With 100 guilds playing simultaneously, this
 * creates 100 concurrent processes and can exhaust RAM.
 *
 * Solution: A semaphore that caps how many yt-dlp spawns can be active
 * system-wide at once.  Requests beyond the cap queue and wait for a slot.
 *
 * This is NOT a process pool (yt-dlp processes are not reusable — they stream
 * audio data and exit when the track ends).  It is a concurrency gate.
 *
 * Configuration:
 *   YTDLP_MAX_CONCURRENT  - max simultaneous yt-dlp spawns (default: 8)
 *   YTDLP_QUEUE_TIMEOUT_MS - max time a queued request waits for a slot (default: 30000)
 *
 * Usage (from audioEngine.js):
 *   const { ytDlpPool } = require('../helpers/ytDlpPool');
 *   const resource = await ytDlpPool.run(() => spawnYtDlp(url));
 */

const { logger } = require('./logger');
const { metrics } = require('./metrics');

const MAX_CONCURRENT   = Number(process.env.YTDLP_MAX_CONCURRENT   || 8);
const QUEUE_TIMEOUT_MS = Number(process.env.YTDLP_QUEUE_TIMEOUT_MS || 30_000);

class YtDlpPool {
  constructor(maxConcurrent = MAX_CONCURRENT, queueTimeoutMs = QUEUE_TIMEOUT_MS) {
    this.maxConcurrent  = maxConcurrent;
    this.queueTimeoutMs = queueTimeoutMs;
    this.active = 0;        // currently running spawns
    this.waiting = [];      // { resolve, reject, timeoutId }
  }

  /**
   * Run fn() when a concurrency slot is available.
   * Returns the result of fn().
   * Rejects with a timeout error if no slot opens within queueTimeoutMs.
   *
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  run(fn) {
    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (this.active < this.maxConcurrent) {
          this._execute(fn, resolve, reject);
        } else {
          // No slot available — queue with timeout
          const timeoutId = setTimeout(() => {
            const idx = this.waiting.findIndex(w => w.timeoutId === timeoutId);
            if (idx !== -1) this.waiting.splice(idx, 1);
            metrics.increment('ytdlp.pool.timeout');
            logger.warn(
              { maxConcurrent: this.maxConcurrent, queueLength: this.waiting.length },
              '[YTDLP-POOL] Request timed out waiting for a slot'
            );
            reject(new Error(`yt-dlp pool: no slot available after ${this.queueTimeoutMs}ms`));
          }, this.queueTimeoutMs);

          this.waiting.push({ attempt, timeoutId });
          metrics.gauge('ytdlp.pool.queue_depth', this.waiting.length);
          logger.debug(
            { active: this.active, queued: this.waiting.length },
            '[YTDLP-POOL] No slot available — queued'
          );
        }
      };

      attempt();
    });
  }

  _execute(fn, resolve, reject) {
    this.active += 1;
    metrics.gauge('ytdlp.pool.active', this.active);
    logger.debug({ active: this.active, max: this.maxConcurrent }, '[YTDLP-POOL] Slot acquired');

    Promise.resolve()
      .then(() => fn())
      .then(resolve, reject)
      .finally(() => {
        this.active -= 1;
        metrics.gauge('ytdlp.pool.active', this.active);
        logger.debug({ active: this.active }, '[YTDLP-POOL] Slot released');
        this._dequeue();
      });
  }

  _dequeue() {
    if (this.waiting.length === 0) return;
    if (this.active >= this.maxConcurrent) return;

    const next = this.waiting.shift();
    metrics.gauge('ytdlp.pool.queue_depth', this.waiting.length);
    clearTimeout(next.timeoutId);
    next.attempt();
  }

  /** Diagnostic snapshot — exposed on /health and /dev diagnostics */
  stats() {
    return {
      active:       this.active,
      queued:       this.waiting.length,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

const ytDlpPool = new YtDlpPool();

module.exports = { YtDlpPool, ytDlpPool };
