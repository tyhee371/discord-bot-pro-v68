const fs = require('node:fs');
const path = require('node:path');
const { logger } = require('../utils/logger');
const { safeRequire } = require('../utils/safeRequire');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function loadCommands(client) {
  const commandsPath = path.join(__dirname, '..', 'commands');
  if (!fs.existsSync(commandsPath)) return;

  const files = walk(commandsPath);

  for (const filePath of files) {
    const rel = path.relative(commandsPath, filePath).split(path.sep);
    const top = rel[0];
    const command = safeRequire(filePath, 'command');
    if (!command) continue;

    // Support both plain objects (data.name) and SlashCommandBuilder (data.toJSON().name)
    const name = command?.data?.name ?? command?.data?.toJSON?.().name;

    if (!name || !command?.execute) {
      logger.warn(`[WARN] Skipping command ${filePath} (missing data name or execute).`);
      continue;
    }

        // Auto-assign moduleKey by top folder (for per-guild module toggles)
    if (!command.moduleKey) {
      const map = {
        music: 'music',
        tickets: 'tickets',
        logs: 'logs',
        roles: 'roles',
        moderation: 'moderation',
        fun: 'fun',
        utility: 'utility',
        greet: 'greet',
        rooms: 'rooms',
      };
      command.moduleKey = map[top] || 'utility';
    }

    // Duplicate protection
    if (client.commands.has(name)) {
      logger.warn(`[WARN] Duplicate command name "${name}" from ${filePath}. Keeping first, skipping this one.`);
      continue;
    }

    // Normalize so the runtime can always use `commandName` lookups.
    command._name = name;
    client.commands.set(name, command);
  }
}

module.exports = { loadCommands };
