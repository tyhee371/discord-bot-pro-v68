const { logger } = require('../helpers/logger');
const { token } = require('../config');
const { createContainer } = require('./container');
const { loadCommands } = require('../handlers/loadCommands');
const { loadComponents } = require('../handlers/loadComponents');
const { loadEvents } = require('../handlers/loadEvents');
const { attachLifecycleHandlers, registerShutdownHandler } = require('./lifecycle');
const { runStartupReconciliation } = require('./reconciliation');
const { HealthServer } = require('./health');
const { cleanupMusicConnections } = require('../services/musicService');
const { scheduler } = require('./durableScheduler');
const { JOB_TYPE: GIVEAWAY_END_JOB } = require('../utils/giveawayTimer');
const { endGiveaway } = require('../utils/giveawayEnd');
const { redisClient } = require('./redis');
const { databaseClient } = require('./database');
const { sharedState } = require('./sharedState');
const { rateLimiter, cooldownManager, lockManager } = require('./rateLimit');
const { discordCache, cacheManager } = require('./cache');

async function startApp() {
  const { client } = createContainer();
  global.__botClient = client;

  // Phase 3: Register shutdown handlers for clean cleanup
  registerShutdownHandler(async () => {
    logger.info('[SHUTDOWN] Cleaning up music connections...');
    await cleanupMusicConnections(client);
  }, 'music_cleanup', 10);

  registerShutdownHandler(async () => {
    logger.info('[SHUTDOWN] Cleaning up temp rooms...');
    // Temp room cleanup will be handled by reconciliation on next startup
  }, 'temp_rooms_cleanup', 5);

  registerShutdownHandler(async () => {
    logger.info('[SHUTDOWN] Cleaning up tickets...');
    // Ticket cleanup will be handled by reconciliation on next startup
  }, 'tickets_cleanup', 5);

  loadCommands(client);
  loadComponents(client);
  loadEvents(client);
  attachLifecycleHandlers(client);

  try {
    await client.login(token);
    logger.info('Bot login successful.');

    // ── Durable scheduler: register handlers and rehydrate ─────────────────
    scheduler.register(GIVEAWAY_END_JOB, async (job, botClient) => {
      const { messageId, channelId, guildId } = job.payload;
      await endGiveaway(botClient, { messageId, channelId, guildId });
    });

    await scheduler.rehydrate(client);
    logger.info('[scheduler] rehydrated — durable timers active');

    // Shutdown hook
    registerShutdownHandler(async () => {
      logger.info('[SHUTDOWN] Flushing durable scheduler...');
      scheduler.shutdown();
    }, 'scheduler_shutdown', 18);

    // Phase 3: Start health check server
    const healthServer = new HealthServer(process.env.HEALTH_PORT || 3000);
    healthServer.start(client);

    // Register health server shutdown
    registerShutdownHandler(async () => {
      logger.info('[SHUTDOWN] Stopping health check server...');
      healthServer.stop();
    }, 'health_server', 15);

    // Register Redis shutdown
    registerShutdownHandler(async () => {
      logger.info('[SHUTDOWN] Disconnecting Redis...');
      await redisClient.disconnect();
    }, 'redis_shutdown', 20);

    // Register PostgreSQL shutdown
    registerShutdownHandler(async () => {
      logger.info('[SHUTDOWN] Disconnecting PostgreSQL...');
      await databaseClient.disconnect();
    }, 'database_shutdown', 19);

    // Phase 4: Initialize Redis and shared state (optional — requires REDIS_URL)
    // redisClient.connect() is a no-op when REDIS_URL is absent/invalid and
    // logs a single INFO message instead of an error flood.
    await redisClient.connect();
    if (redisClient.isAvailable()) {
      logger.info('[bootstrap] Redis connected — initializing Phase 4 shared state components');
      try {
        await sharedState.initialize();
        await rateLimiter.initialize();
        await cooldownManager.initialize();
        await lockManager.initialize();
        await discordCache.initialize();
        logger.info('[bootstrap] Phase 4 components initialized successfully');

    // Prevent memory leak: evict expired in-process cache entries every 5 minutes.
    // Without this the memoryCache Map grows unboundedly for the lifetime of the process.
    const _cacheCleanupInterval = setInterval(() => {
      cacheManager.cleanup();
      discordCache.cleanup();
    }, 5 * 60 * 1000);
    _cacheCleanupInterval.unref(); // don't block process exit
      } catch (error) {
        logger.warn({ err: error }, '[bootstrap] Phase 4 component init failed — falling back to in-process implementations');
      }
    } else {
      logger.info('[bootstrap] Redis unavailable — Phase 4 components using in-process fallbacks (rate-limiting is per-process)');
    }

    // Phase 5: Initialize PostgreSQL (optional — requires DATABASE_URL)
    // databaseClient.connect() is a no-op when DATABASE_URL is absent and logs
    // a single INFO message. When connected, analytics + audit logging activate.
    if (process.env.DATABASE_URL) {
      await databaseClient.connect();
      if (databaseClient.isAvailable()) {
        logger.info('[bootstrap] PostgreSQL connected — Phase 5 analytics and audit logging active');
      }
    } else {
      logger.info('[bootstrap] DATABASE_URL not set — Phase 5 PostgreSQL features disabled (SQLite primary store active)');
    }

    // Phase 3: Run startup reconciliation after client is ready
    client.once('clientReady', async () => {
      logger.info('Bot ready. Starting Phase 3 reconciliation...');
      try {
        await runStartupReconciliation(client);
        logger.info('Phase 3 reconciliation complete.');
      } catch (error) {
        logger.error(`Phase 3 reconciliation failed: ${error.message}`);
      }
    });

  } catch (err) {
    logger.fatal({ err }, 'Failed to login');
    throw err;
  }

  return client;
}

module.exports = { startApp };
