const { Events } = require('discord.js');
const { logger } = require('../utils/logger');
const { runStartupChecks } = require('../utils/startupChecks');
const { startActivityRotation } = require('../utils/activityRotation');
const { getStartupLoadErrors, clearStartupLoadErrors } = require('../utils/safeRequire');
const { reportStartupLoadErrors } = require('../utils/errorReporter');
const { initDevAccess } = require('../utils/devAccess');
const { startPrisonScheduler } = require('../utils/prisonScheduler');
const { restoreTimers } = require('../commands/giveaway/giveaway');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info({ user: client.user?.tag, id: client.user?.id }, 'Ready');

    // Make the client available for process-level error reporting
    global.__botClient = client;

    // Load Discord Developer Portal Team members for /dev gating (non-fatal)
    await initDevAccess().catch(() => {});

    // Report any module load failures that were captured during startup
    const loadErrors = getStartupLoadErrors();
    if (loadErrors.length) {
      await reportStartupLoadErrors(client, loadErrors);
      clearStartupLoadErrors();
    }

    await runStartupChecks();
    startActivityRotation(client);
    // _presenceRotationTimer is stored on client for graceful cleanup.
    // The interval already calls t.unref() so it won't block process exit,
    // but we clear it explicitly on shutdown via lifecycle.js if needed.

    // Restore giveaway end timers after bot restart
    restoreTimers(client).catch(err =>
      console.error('[GIVEAWAY] Failed to restore timers on ready:', err)
    );

    // Background job: auto-remove "prison" roles after their duration ends.
    startPrisonScheduler(client);
  },
};
