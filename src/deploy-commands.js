const { logger } = require('./utils/logger');
/**
 * Deploy slash commands.
 * Usage:
 *   node src/deploy-commands.js --guild
 *   node src/deploy-commands.js --global
 */
const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');
const { token, clientId, guildId } = require('./config');
const { safeRequire } = require('./utils/safeRequire');

function validateUniqueCommandNames(commands) {
  const seen = new Map();
  const dups = [];
  for (const c of commands) {
    const name = c?.name;
    if (!name) continue;
    if (seen.has(name)) dups.push([name, seen.get(name), c]);
    else seen.set(name, c);
  }
  return dups;
}


function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  // Default behavior:
  // - If GUILD_ID exists, deploy to that guild (instant updates)
  // - Otherwise, deploy globally
  const argGuild = args.includes('--guild');
  const argGlobal = args.includes('--global');
  const isGuild = argGuild || (!argGlobal && Boolean(guildId));
  const isGlobal = argGlobal || (!argGuild && !guildId);

  if (isGuild && !guildId) {
    logger.info('Missing GUILD_ID in .env for guild deploy.');
    process.exitCode = 1;
    return;
  }

  const commandsPath = path.join(__dirname, 'commands');
  const files = walk(commandsPath);

  const commands = [];
  for (const filePath of files) {
    const cmd = safeRequire(filePath, 'command');
    if (!cmd) continue;
    if (cmd?.data?.toJSON) commands.push(cmd.data.toJSON());
  }


const dups = validateUniqueCommandNames(commands);
if (dups.length) {
  logger.error(
    { duplicates: dups.map(([n]) => n) },
    `Duplicate slash command names found: ${dups.map(([n]) => n).join(', ')}. Fix by renaming or removing duplicates.`,
  );
  process.exitCode = 1;
  return;
}

  const rest = new REST({ version: '10' }).setToken(token);

  if (isGuild) {
    logger.info(`Deploying ${commands.length} commands to guild ${guildId}...`);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    logger.info('Done.');
    return;
  }

  logger.info(`Deploying ${commands.length} commands globally...`);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  logger.info('Done.');
}

main().catch((e) => {
  logger.error(e);
  process.exitCode = 1;
    return;
});
