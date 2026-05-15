const fs = require('node:fs');
const path = require('node:path');
const { logger } = require('../utils/logger');
const { safeRequire } = require('../utils/safeRequire');
const { reportProcessError } = require('../utils/errorReporter');

function loadEvents(client) {
  const eventsPath = path.join(__dirname, '..', 'events');
  if (!fs.existsSync(eventsPath)) return;

  const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));

  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = safeRequire(filePath, 'event');
    if (!event) continue;

    if (!event?.name || !event?.execute) {
      logger.warn(`[WARN] Skipping event ${filePath} (missing name/execute).`);
      continue;
    }

    // List of critical events that should report errors to Discord
    const criticalEvents = ['interactionCreate', 'voiceStateUpdate', 'messageCreate', 'guildMemberAdd', 'guildMemberRemove'];
    const isCritical = criticalEvents.includes(event.name);

    if (event.once) {
      client.once(event.name, async (...args) => {
        try {
          await event.execute(client, ...args);
        } catch (err) {
          logger.error({ err, event: event.name, filePath }, `[EVENT] Error in once handler: ${event.name}`);
          if (isCritical) {
            reportProcessError(client, err, `Event (once): ${event.name}`).catch(e => {
              logger.warn({ err: e }, `Failed to report error for event ${event.name}`);
            });
          }
        }
      });
    }
    else {
      client.on(event.name, async (...args) => {
        try {
          await event.execute(client, ...args);
        } catch (err) {
          logger.error({ err, event: event.name, filePath }, `[EVENT] Error in handler: ${event.name}`);
          if (isCritical) {
            reportProcessError(client, err, `Event: ${event.name}`).catch(e => {
              logger.warn({ err: e }, `Failed to report error for event ${event.name}`);
            });
          }
        }
      });
    }
  }
}

module.exports = { loadEvents };
