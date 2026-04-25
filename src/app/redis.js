const { createClient } = require('redis');
const { logger } = require('../utils/logger');

/**
 * Phase 4: Redis Client for Shared State
 * Provides Redis-backed storage for shared runtime state
 */

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  /**
   * Initialize Redis connection
   */
  async connect() {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

      this.client = createClient({
        url: redisUrl,
        socket: {
          connectTimeout: 60000,
          lazyConnect: true,
        },
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            logger.error('Redis connection refused');
            return new Error('Redis connection refused');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            logger.error('Redis retry time exhausted');
            return new Error('Retry time exhausted');
          }
          if (options.attempt > 10) {
            logger.error('Redis retry attempts exhausted');
            return undefined;
          }
          // Exponential backoff
          return Math.min(options.attempt * 100, 3000);
        }
      });

      this.client.on('error', (err) => {
        logger.error(`Redis error: ${err.message}`);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        logger.info('Redis connected');
        this.isConnected = true;
      });

      this.client.on('disconnect', () => {
        logger.warn('Redis disconnected');
        this.isConnected = false;
      });

      await this.client.connect();
      logger.info('Redis client initialized successfully');
    } catch (error) {
      logger.error(`Failed to initialize Redis: ${error.message}`);
      // Don't throw - allow fallback to in-memory storage
      this.client = null;
    }
  }

  /**
   * Check if Redis is available
   */
  isAvailable() {
    return this.client && this.isConnected;
  }

  /**
   * Get value from Redis
   */
  async get(key) {
    if (!this.isAvailable()) return null;

    try {
      return await this.client.get(key);
    } catch (error) {
      logger.warn(`Redis GET failed for key ${key}: ${error.message}`);
      return null;
    }
  }

  /**
   * Set value in Redis with optional TTL
   */
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
      logger.warn(`Redis SET failed for key ${key}: ${error.message}`);
      return false;
    }
  }

  /**
   * Delete key from Redis
   */
  async del(key) {
    if (!this.isAvailable()) return false;

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.warn(`Redis DEL failed for key ${key}: ${error.message}`);
      return false;
    }
  }

  /**
   * Set multiple keys
   */
  async mset(keyValuePairs) {
    if (!this.isAvailable()) return false;

    try {
      await this.client.mSet(keyValuePairs);
      return true;
    } catch (error) {
      logger.warn(`Redis MSET failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Get multiple keys
   */
  async mget(keys) {
    if (!this.isAvailable()) return new Array(keys.length).fill(null);

    try {
      return await this.client.mGet(keys);
    } catch (error) {
      logger.warn(`Redis MGET failed: ${error.message}`);
      return new Array(keys.length).fill(null);
    }
  }

  /**
   * Check if key exists
   */
  async exists(key) {
    if (!this.isAvailable()) return false;

    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.warn(`Redis EXISTS failed for key ${key}: ${error.message}`);
      return false;
    }
  }

  /**
   * Set key with TTL only if it doesn't exist
   */
  async setnx(key, value, ttlSeconds = null) {
    if (!this.isAvailable()) return false;

    try {
      let result;
      if (ttlSeconds) {
        result = await this.client.set(key, value, { NX: true, EX: ttlSeconds });
      } else {
        result = await this.client.set(key, value, { NX: true });
      }
      return result === 'OK';
    } catch (error) {
      logger.warn(`Redis SETNX failed for key ${key}: ${error.message}`);
      return false;
    }
  }

  /**
   * Increment counter
   */
  async incr(key) {
    if (!this.isAvailable()) return null;

    try {
      return await this.client.incr(key);
    } catch (error) {
      logger.warn(`Redis INCR failed for key ${key}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get TTL for key
   */
  async ttl(key) {
    if (!this.isAvailable()) return -2;

    try {
      return await this.client.ttl(key);
    } catch (error) {
      logger.warn(`Redis TTL failed for key ${key}: ${error.message}`);
      return -2;
    }
  }

  /**
   * Close Redis connection
   */
  async disconnect() {
    if (this.client) {
      try {
        await this.client.disconnect();
        logger.info('Redis client disconnected');
      } catch (error) {
        logger.warn(`Error disconnecting Redis: ${error.message}`);
      }
    }
    this.isConnected = false;
  }
}

// Global Redis client instance
const redisClient = new RedisClient();

module.exports = {
  RedisClient,
  redisClient,
};
