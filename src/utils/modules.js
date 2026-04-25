const { getGuildSettings, setGuildSettings } = require('./settings');

const DEFAULTS = {
  music: true,
  tickets: true,
  logs: true,
  roles: true,
  moderation: true,
  fun: true,
  utility: true,
  greet: true,
  rooms: true,
};

async function getModules(guildId) {
  const s = await getGuildSettings(guildId);
  const modules = { ...DEFAULTS, ...(s.modules ?? {}) };
  return modules;
}

async function isModuleEnabled(guildId, moduleKey) {
  const modules = await getModules(guildId);
  // unknown module => enabled by default
  if (modules[moduleKey] === undefined) return true;
  return Boolean(modules[moduleKey]);
}

async function setModuleEnabled(guildId, moduleKey, enabled) {
  const s = await getGuildSettings(guildId);
  const modules = { ...DEFAULTS, ...(s.modules ?? {}) };
  modules[moduleKey] = Boolean(enabled);
  await setGuildSettings(guildId, { modules });
  return modules;
}

module.exports = { getModules, isModuleEnabled, setModuleEnabled, DEFAULTS };
