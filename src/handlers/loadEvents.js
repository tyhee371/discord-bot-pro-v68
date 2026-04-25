const fs = require('node:fs');
const path = require('node:path');
const { logger } = require('../utils/logger');
const { safeRequire } = require('../utils/safeRequire');

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

        if (event.once) {
      client.once(event.name, async (...args) => {
        try {
          await event.execute(client, ...args);
        } catch (err) {
          logger.error({ err, event: event.name, filePath }, `[EVENT] Error in once handler: ${event.name}`);
        }
      });
    }
        else {
      client.on(event.name, async (...args) => {
        try {
          await event.execute(client, ...args);
        } catch (err) {
          logger.error({ err, event: event.name, filePath }, `[EVENT] Error in handler: ${event.name}`);
        }
      });
    }
  }
}

module.exports = { loadEvents };
