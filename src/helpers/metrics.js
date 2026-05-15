/**
 * metrics.js — lightweight in-process counters and event-rate tracking.
 *
 * Zero dependencies. Works with or without Redis.
 * Consumed by /dev diagnostics and the health endpoint.
 *
 * Three metric types:
 *   counter   — monotonically increasing integer (commands executed, errors, …)
 *   gauge     — point-in-time value (queue depth, active connections, …)
 *   rate      — events-per-minute over a sliding 60-second window
 *
 * Usage:
 *   const { metrics } = require('../helpers/metrics');
 *
 *   metrics.increment('commands.executed');
 *   metrics.increment('commands.error', { command: 'play' });
 *   metrics.gauge('music.queue.depth', guildQueue.length);
 *   metrics.rate('starboard.reactions');
 *
 *   const snapshot = metrics.snapshot();
 */

const RATE_WINDOW_MS = 60_000; // 60-second sliding window for rate metrics

class Metrics {
  constructor() {
    /** @type {Map<string, number>} */
    this._counters = new Map();
    /** @type {Map<string, number>} */
    this._gauges = new Map();
    /**
     * Each rate bucket stores an array of timestamps.
     * @type {Map<string, number[]>}
     */
    this._rateBuckets = new Map();

    this._startedAt = Date.now();
  }

  // ── Counters ───────────────────────────────────────────────────────────────

  /**
   * Increment a counter by `amount` (default 1).
   * Labels are flattened into the key: `name{k=v,k=v}`.
   *
   * @param {string} name
   * @param {Record<string,string>} [labels]
   * @param {number} [amount]
   */
  increment(name, labels, amount = 1) {
    const key = this._key(name, labels);
    this._counters.set(key, (this._counters.get(key) ?? 0) + amount);
  }

  /**
   * Read the current value of a counter (0 if never set).
   * @param {string} name
   * @param {Record<string,string>} [labels]
   * @returns {number}
   */
  getCounter(name, labels) {
    return this._counters.get(this._key(name, labels)) ?? 0;
  }

  // ── Gauges ─────────────────────────────────────────────────────────────────

  /**
   * Set a gauge to an absolute value.
   * @param {string} name
   * @param {number} value
   * @param {Record<string,string>} [labels]
   */
  gauge(name, value, labels) {
    this._gauges.set(this._key(name, labels), value);
  }

  /**
   * Read the current value of a gauge (0 if never set).
   * @param {string} name
   * @param {Record<string,string>} [labels]
   * @returns {number}
   */
  getGauge(name, labels) {
    return this._gauges.get(this._key(name, labels)) ?? 0;
  }

  // ── Rates ──────────────────────────────────────────────────────────────────

  /**
   * Record one occurrence of an event for rate tracking.
   * Call this on every event; the rate is computed over the last 60 seconds.
   *
   * @param {string} name
   * @param {Record<string,string>} [labels]
   */
  rate(name, labels) {
    const key = this._key(name, labels);
    if (!this._rateBuckets.has(key)) this._rateBuckets.set(key, []);
    const bucket = this._rateBuckets.get(key);
    const now = Date.now();
    bucket.push(now);
    // Prune timestamps outside the window (keep array small)
    const cutoff = now - RATE_WINDOW_MS;
    let i = 0;
    while (i < bucket.length && bucket[i] < cutoff) i++;
    if (i > 0) bucket.splice(0, i);
  }

  /**
   * Get the events-per-minute rate for a metric over the last 60 s window.
   * @param {string} name
   * @param {Record<string,string>} [labels]
   * @returns {number}
   */
  getRate(name, labels) {
    const key = this._key(name, labels);
    const bucket = this._rateBuckets.get(key);
    if (!bucket || bucket.length === 0) return 0;
    const cutoff = Date.now() - RATE_WINDOW_MS;
    const recent = bucket.filter((t) => t >= cutoff);
    // Scale to events/minute
    return Math.round((recent.length / (RATE_WINDOW_MS / 1000)) * 60 * 10) / 10;
  }

  // ── Snapshot ───────────────────────────────────────────────────────────────

  /**
   * Return a plain object containing all current metric values.
   * Safe to JSON-serialise.
   */
  snapshot() {
    const counters = Object.fromEntries(this._counters);
    const gauges = Object.fromEntries(this._gauges);

    const rates = {};
    for (const key of this._rateBuckets.keys()) {
      rates[key] = this.getRate(key);
    }

    return {
      uptimeSeconds: Math.floor((Date.now() - this._startedAt) / 1000),
      counters,
      gauges,
      rates,
    };
  }

  /**
   * Reset all metrics (useful for tests).
   */
  reset() {
    this._counters.clear();
    this._gauges.clear();
    this._rateBuckets.clear();
    this._startedAt = Date.now();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _key(name, labels) {
    if (!labels || Object.keys(labels).length === 0) return name;
    const parts = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${name}{${parts}}`;
  }
}

/** Global singleton — import this everywhere. */
const metrics = new Metrics();

module.exports = { Metrics, metrics };
