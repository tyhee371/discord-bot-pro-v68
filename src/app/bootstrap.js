const { logger } = require('../utils/logger');
const { token } = require('../config');
const { createContainer } = require('./container');
const { loadCommands } = require('../handlers/loadCommands');
const { loadComponents } = require('../handlers/loadComponents');
const { loadEvents } = require('../handlers/loadEvents');
const { attachLifecycleHandlers, registerShutdownHandler } = require('./lifecycle');
const { runStartupReconciliation } = require('./reconciliation');
const { HealthServer } = require('./health');
const { cleanupMusicConnections } = require('../services/musicService');
const { redisClient } = require('./redis');
const { sharedState } = require('./sharedState');
const { rateLimiter, cooldownManager, lockManager } = require('./rateLimit');
const { discordCache } = require('./cache');

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

    // Phase 4: Initialize Redis and shared state
    logger.info('Initializing Phase 4 components...');
    try {
      await redisClient.connect();
      await sharedState.initialize();
      await rateLimiter.initialize();
      await cooldownManager.initialize();
      await lockManager.initialize();
      await discordCache.initialize();
      logger.info('Phase 4 components initialized successfully');
    } catch (error) {
      logger.warn(`Phase 4 initialization failed, continuing with fallbacks: ${error.message}`);
    }

    // Phase 3: Run startup reconciliation after client is ready
    client.once('ready', async () => {
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
