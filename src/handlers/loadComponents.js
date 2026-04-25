const fs = require('node:fs');
const path = require('node:path');
const { logger } = require('../utils/logger');
const { safeRequire } = require('../utils/safeRequire');

function loadComponentType(client, type) {
  const basePath = path.join(__dirname, '..', 'components', type);
  if (!fs.existsSync(basePath)) return;

  const files = fs.readdirSync(basePath).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const filePath = path.join(basePath, file);
    const handler = safeRequire(filePath, `component:${type}`);
    if (!handler) continue;

    if (!handler?.id || !handler?.execute) {
      logger.warn(`[WARN] Skipping ${filePath} (missing id/execute).`);
      continue;
    }

    if (client.components[type].has(handler.id)) {
      logger.warn(`[WARN] Duplicate component id "${handler.id}" in ${filePath}. Keeping first, skipping this one.`);
      continue;
    }
    client.components[type].set(handler.id, handler);
  }
}

function loadComponents(client) {
  loadComponentType(client, 'modals');
  loadComponentType(client, 'buttons');
  loadComponentType(client, 'selects');
}

module.exports = { loadComponents };
