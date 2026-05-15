const { createClient } = require('redis');
const { logger } = require('../helpers/logger');

/**
 * Redis Client (Phase 4 — optional)
 *
 * Phase 3 fixes applied:
 * - REDIS_URL is validated before attempting connection. The previous code
 *   called createClient() with a malformed URL, producing an uncaught
 *   "Invalid URL" error on every boot even when Redis was intentionally
 *   absent.  Now we skip the connection attempt entirely when REDIS_URL is
 *   absent or clearly invalid, and log a single INFO line instead of an ERROR.
 * - retry_strategy used the redis v3 API but the project uses redis v4 which
 *   configures retries via socket.reconnectStrategy.  The old option was
 *   silently ignored.  Fixed to use the correct v4 API.
 * - CRLF line endings converted to LF.
 */

function isValidRedisUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'redis:' || parsed.protocol === 'rediss:';
  } catch {
    return false;
  }
}

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    const redisUrl = process.env.REDIS_URL;

    if (!isValidRedisUrl(redisUrl)) {
      logger.info(
        '[REDIS] REDIS_URL is absent or invalid — skipping Redis connection. ' +
        'Phase 4 features (distributed rate-limiting, shared state) will use ' +
        'in-process fallbacks. Set a valid redis:// URL to enable Redis.'
      );
      return;
    }

    try {
      let _errorLogged = false;  // suppress repeated ECONNREFUSED spam

      this.client = createClient({
        url: redisUrl,
        socket: {
          connectTimeout: 5_000,
          reconnectStrategy: (retries) => {
            // After 5 failed attempts (~15s total), give up entirely and
            // fall back to in-process implementations. This prevents the
            // 50-errors-per-second flood when Redis is simply not running.
            if (retries >= 5) {
              logger.warn('[REDIS] Could not connect after 5 attempts — disabling Redis. Phase 4 will use in-process fallbacks.');
              this.client = null;
              return new Error('Redis unreachable — giving up');
            }
            const delay = Math.min(retries * 500, 3_000);
            logger.info(`[REDIS] Reconnecting in ${delay}ms (attempt ${retries + 1}/5)...`);
            return delay;
          },
        },
      });

      this.client.on('error', (err) => {
        // Suppress repeated errors — only log the first one per reconnect cycle.
        // 'connect' fires on TCP handshake (before auth); 'ready' fires after auth.
        // Auth failures appear here as ECONNRESET/ERR WRONGPASS after a 'connect'.
        if (!_errorLogged) {
          const isAuth = err.message?.includes('WRONGPASS') || err.message?.includes('NOAUTH');
          if (isAuth) {
            logger.error('[REDIS] Authentication failed — check REDIS_PASSWORD in .env matches docker-compose REDIS_PASSWORD');
          } else {
            logger.warn({ code: err.code }, '[REDIS] Connection failed — retrying with backoff');
          }
          _errorLogged = true;
        }
        this.isConnected = false;
      });

      // 'connect' = TCP handshake only (before auth) — do NOT mark as connected yet
      // 'ready'   = TCP + auth complete — safe to use
      this.client.on('ready', () => {
        logger.info('[REDIS] Connected and authenticated');
        _errorLogged = false;
        this.isConnected = true;
      });

      this.client.on('disconnect', () => {
        if (this.isConnected) logger.warn('[REDIS] Disconnected');
        this.isConnected = false;
      });

      await this.client.connect();
      logger.info('[REDIS] Client initialized successfully');
    } catch (error) {
      // Swallow the "giving up" error from reconnectStrategy — it's already logged above.
      if (!error.message?.includes('giving up')) {
        logger.warn({ err: error }, '[REDIS] Failed to initialize — Phase 4 will use in-memory fallbacks');
      }
      this.client = null;
    }
  }

  isAvailable() {
    return this.client !== null && this.isConnected;
  }

  async get(key) {
    if (!this.isAvailable()) return null;
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.warn({ key, err: error }, '[REDIS] GET failed');
      return null;
    }
  }

  async set(key, value, ttlSeconds = null) {
    if (!this.isAvailable()) return false;
    try {
      if (ttlSeconds) {
        await this.client.setEx(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
      return true;
    } catch (error) {
      logger.warn({ key, err: error }, '[REDIS] SET failed');
      return false;
    }
  }

  async del(key) {
    if (!this.isAvailable()) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.warn({ key, err: error }, '[REDIS] DEL failed');
      return false;
    }
  }

  async mset(keyValuePairs) {
    if (!this.isAvailable()) return false;
    try {
      await this.client.mSet(keyValuePairs);
      return true;
    } catch (error) {
      logger.warn({ err: error }, '[REDIS] MSET failed');
      return false;
    }
  }

  async mget(keys) {
    if (!this.isAvailable()) return new Array(keys.length).fill(null);
    try {
      return await this.client.mGet(keys);
    } catch (error) {
      logger.warn({ err: error }, '[REDIS] MGET failed');
      return new Array(keys.length).fill(null);
    }
  }

  async exists(key) {
    if (!this.isAvailable()) return false;
    try {
      return (await this.client.exists(key)) === 1;
    } catch (error) {
      logger.warn({ key, err: error }, '[REDIS] EXISTS failed');
      return false;
    }
  }

  async setnx(key, value, ttlSeconds = null) {
    if (!this.isAvailable()) return false;
    try {
      const opts = ttlSeconds ? { NX: true, EX: ttlSeconds } : { NX: true };
      const result = await this.client.set(key, value, opts);
      return result === 'OK';
    } catch (error) {
      logger.warn({ key, err: error }, '[REDIS] SETNX failed');
      return false;
    }
  }

  async incr(key) {
    if (!this.isAvailable()) return null;
    try {
      return await this.client.incr(key);
    } catch (error) {
      logger.warn({ key, err: error }, '[REDIS] INCR failed');
      return null;
    }
  }

  async ttl(key) {
    if (!this.isAvailable()) return -2;
    try {
      return await this.client.ttl(key);
    } catch (error) {
      logger.warn({ key, err: error }, '[REDIS] TTL failed');
      return -2;
    }
  }

  async disconnect() {
    if (this.client) {
      try {
        await this.client.disconnect();
        logger.info('[REDIS] Client disconnected');
      } catch (error) {
        logger.warn({ err: error }, '[REDIS] Error during disconnect');
      }
    }
    this.isConnected = false;
  }
}

const redisClient = new RedisClient();

module.exports = { RedisClient, redisClient };
