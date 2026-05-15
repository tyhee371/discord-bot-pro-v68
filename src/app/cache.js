const { sharedState } = require('./sharedState');
const { logger } = require('../helpers/logger');

/**
 * Phase 4: Cache Manager for Expensive Operations
 * Provides TTL-based caching for Discord API calls to reduce rate limits
 */

class CacheManager {
  constructor() {
    this.initialized = false;
    this.memoryCache = new Map();
  }

  /**
   * Initialize the cache manager
   */
  async initialize() {
    await sharedState.initialize();
    this.initialized = true;
    logger.info('[CACHE] Cache manager initialized');
  }

  /**
   * Get cached value or fetch and cache
   * @param {string} key - Cache key
   * @param {Function} fetcher - Function to fetch data if not cached
   * @param {number} ttlSeconds - TTL in seconds
   * @returns {any} Cached or fetched data
   */
  async getOrFetch(key, fetcher, ttlSeconds = 300) {
    if (!this.initialized) {
      await this.initialize();
    }

    // Try memory cache first (faster)
    const memoryKey = `cache:${key}`;
    const memoryData = this.memoryCache.get(memoryKey);
    if (memoryData && memoryData.expires > Date.now()) {
      return memoryData.value;
    }

    // Try Redis cache
    try {
      const cached = await sharedState.get('cache', key);
      if (cached !== null) {
        // Store in memory for faster access
        this.memoryCache.set(memoryKey, {
          value: cached,
          expires: Date.now() + (ttlSeconds * 1000)
        });
        return cached;
      }
    } catch (error) {
      logger.debug(`[CACHE] Redis cache miss for ${key}: ${error.message}`);
    }

    // Fetch fresh data
    try {
      const data = await fetcher();
      if (data !== undefined && data !== null) {
        // Cache the result
        await sharedState.set('cache', key, data, ttlSeconds);

        // Also cache in memory
        this.memoryCache.set(memoryKey, {
          value: data,
          expires: Date.now() + (ttlSeconds * 1000)
        });

        logger.debug(`[CACHE] Cached ${key} for ${ttlSeconds}s`);
      }
      return data;
    } catch (error) {
      logger.warn(`[CACHE] Fetch failed for ${key}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Manually set cache value
   */
  async set(key, value, ttlSeconds = 300) {
    if (!this.initialized) {
      await this.initialize();
    }

    await sharedState.set('cache', key, value, ttlSeconds);

    // Also cache in memory
    const memoryKey = `cache:${key}`;
    this.memoryCache.set(memoryKey, {
      value,
      expires: Date.now() + (ttlSeconds * 1000)
    });
  }

  /**
   * Clear cache entry
   */
  async clear(key) {
    await sharedState.delete('cache', key);
    this.memoryCache.delete(`cache:${key}`);
    logger.debug(`[CACHE] Cleared cache for ${key}`);
  }

  /**
   * Clear all cache entries matching pattern
   */
  async clearPattern(pattern) {
    // Memory cache: iterate and delete matching keys
    let memCleared = 0;
    const memPattern = `cache:${pattern}`;
    const isGlob = memPattern.includes('*');
    for (const key of this.memoryCache.keys()) {
      const matches = isGlob
        ? key.startsWith(memPattern.replace('*', ''))
        : key === memPattern;
      if (matches) {
        this.memoryCache.delete(key);
        memCleared++;
      }
    }

    // Redis: use SCAN (non-blocking, cursor-based) instead of KEYS (blocks server)
    if (sharedState.redisAvailable) {
      try {
        const { redisClient } = require('./redis');
        const redisPattern = `bot:cache:${pattern}`;
        let cursor = 0;
        let totalDeleted = 0;
        do {
          const [nextCursor, keys] = await redisClient.client.scan(cursor, {
            MATCH: redisPattern,
            COUNT: 100,
          });
          cursor = Number(nextCursor);
          if (keys.length > 0) {
            await redisClient.client.del(keys);
            totalDeleted += keys.length;
          }
        } while (cursor !== 0);

        if (totalDeleted > 0) {
          logger.debug(`[CACHE] SCAN cleared ${totalDeleted} Redis keys matching ${redisPattern}`);
        }
      } catch (err) {
        logger.debug(`[CACHE] Redis SCAN clearPattern failed for ${pattern}: ${err.message}`);
      }
    }

    if (memCleared > 0) {
      logger.debug(`[CACHE] Cleared ${memCleared} memory cache entries matching ${pattern}`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      memoryCacheSize: this.memoryCache.size,
      redisAvailable: sharedState.redisAvailable
    };
  }

  /**
   * Clean up expired memory cache entries
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, data] of this.memoryCache.entries()) {
      if (data.expires <= now) {
        this.memoryCache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`[CACHE] Cleaned up ${cleaned} expired memory cache entries`);
    }
  }
}

/**
 * Cached Discord API operations
 */
class DiscordCache {
  constructor() {
    this.cacheManager = new CacheManager();
  }

  /**
   * Initialize the Discord cache
   */
  async initialize() {
    await this.cacheManager.initialize();
  }

  /**
   * Get cached guild member
   * @param {Guild} guild - Discord guild
   * @param {string} userId - User ID
   * @returns {GuildMember|null}
   */
  async getMember(guild, userId) {
    const key = `guild:${guild.id}:member:${userId}`;

    return await this.cacheManager.getOrFetch(key, async () => {
      try {
        return await guild.members.fetch(userId);
      } catch {
        return null;
      }
    }, 300); // 5 minutes TTL
  }

  /**
   * Get cached guild
   * @param {Client} client - Discord client
   * @param {string} guildId - Guild ID
   * @returns {Guild|null}
   */
  async getGuild(client, guildId) {
    const key = `guild:${guildId}`;

    return await this.cacheManager.getOrFetch(key, async () => {
      try {
        return await client.guilds.fetch(guildId);
      } catch {
        return null;
      }
    }, 600); // 10 minutes TTL
  }

  /**
   * Get cached channel
   * @param {Client} client - Discord client
   * @param {string} channelId - Channel ID
   * @returns {Channel|null}
   */
  async getChannel(client, channelId) {
    const key = `channel:${channelId}`;

    return await this.cacheManager.getOrFetch(key, async () => {
      try {
        return await client.channels.fetch(channelId);
      } catch {
        return null;
      }
    }, 600); // 10 minutes TTL
  }

  /**
   * Get cached user
   * @param {Client} client - Discord client
   * @param {string} userId - User ID
   * @returns {User|null}
   */
  async getUser(client, userId) {
    const key = `user:${userId}`;

    return await this.cacheManager.getOrFetch(key, async () => {
      try {
        return await client.users.fetch(userId);
      } catch {
        return null;
      }
    }, 1800); // 30 minutes TTL for users
  }

  /**
   * Get cached role
   * @param {Guild} guild - Discord guild
   * @param {string} roleId - Role ID
   * @returns {Role|null}
   */
  async getRole(guild, roleId) {
    const key = `guild:${guild.id}:role:${roleId}`;

    return await this.cacheManager.getOrFetch(key, async () => {
      try {
        return await guild.roles.fetch(roleId);
      } catch {
        return null;
      }
    }, 600); // 10 minutes TTL
  }

  /**
   * Invalidate guild cache (call when guild data changes)
   */
  async invalidateGuild(guildId) {
    await this.cacheManager.clearPattern(`guild:${guildId}:*`);
    await this.cacheManager.clear(`guild:${guildId}`);
  }

  /**
   * Invalidate member cache
   */
  async invalidateMember(guildId, userId) {
    await this.cacheManager.clear(`guild:${guildId}:member:${userId}`);
  }

  /**
   * Invalidate channel cache
   */
  async invalidateChannel(channelId) {
    await this.cacheManager.clear(`channel:${channelId}`);
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return this.cacheManager.getStats();
  }

  /**
   * Clean up expired cache entries
   */
  cleanup() {
    this.cacheManager.cleanup();
  }
}

// Global instances
const cacheManager = new CacheManager();
const discordCache = new DiscordCache();

module.exports = {
  CacheManager,
  DiscordCache,
  cacheManager,
  discordCache,
};
