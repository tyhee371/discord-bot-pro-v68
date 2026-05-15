/**
 * Command Manifest — single source of truth for slash/prefix parity.
 *
 * Each entry describes a logical command available in the bot.
 * Fields:
 *   name        — canonical command name
 *   aliases     — prefix-only aliases (empty if none)
 *   category    — module/category key (matches module guard keys)
 *   slash       — true if registered as a slash command
 *   prefix      — true if available via prefix
 *   description — short user-facing description
 *   staffOnly   — requires isStaff() check
 *   cooldownSeconds — default cooldown (prefix guard)
 */

const COMMAND_MANIFEST = [
  // ─── FUN ────────────────────────────────────────────────────────────────────
  { name: 'hug',    aliases: ['h'],  category: 'fun', slash: true,  prefix: true,  description: 'Hug a user',    staffOnly: false, cooldownSeconds: 1 },
  { name: 'kiss',   aliases: ['k'],  category: 'fun', slash: true,  prefix: true,  description: 'Kiss a user',   staffOnly: false, cooldownSeconds: 1 },
  { name: 'slap',   aliases: [],     category: 'fun', slash: true,  prefix: true,  description: 'Slap a user',   staffOnly: false, cooldownSeconds: 1 },
  { name: 'pat',    aliases: [],     category: 'fun', slash: true,  prefix: true,  description: 'Pat a user',    staffOnly: false, cooldownSeconds: 1 },
  { name: 'cuddle', aliases: [],     category: 'fun', slash: true,  prefix: true,  description: 'Cuddle a user', staffOnly: false, cooldownSeconds: 1 },
  { name: 'poke',   aliases: [],     category: 'fun', slash: true,  prefix: true,  description: 'Poke a user',   staffOnly: false, cooldownSeconds: 1 },
  { name: 'bite',   aliases: [],     category: 'fun', slash: true,  prefix: true,  description: 'Bite a user',   staffOnly: false, cooldownSeconds: 1 },
  { name: 'tickle', aliases: [],     category: 'fun', slash: true,  prefix: true,  description: 'Tickle a user', staffOnly: false, cooldownSeconds: 1 },
  { name: 'wave',   aliases: [],     category: 'fun', slash: true,  prefix: true,  description: 'Wave at someone', staffOnly: false, cooldownSeconds: 1 },
  { name: 'dance',  aliases: [],     category: 'fun', slash: true,  prefix: true,  description: 'Dance',         staffOnly: false, cooldownSeconds: 1 },
  { name: 'blush',  aliases: [],     category: 'fun', slash: true,  prefix: true,  description: 'Blush',         staffOnly: false, cooldownSeconds: 1 },
  { name: 'cry',    aliases: [],     category: 'fun', slash: true,  prefix: true,  description: 'Cry',           staffOnly: false, cooldownSeconds: 1 },
  { name: 'smile',  aliases: [],     category: 'fun', slash: true,  prefix: true,  description: 'Smile',         staffOnly: false, cooldownSeconds: 1 },

  // ─── UTILITY ────────────────────────────────────────────────────────────────
  { name: 'help',       aliases: [],                                    category: 'utility', slash: true,  prefix: true,  description: 'Show help',                staffOnly: false, cooldownSeconds: 2 },
  { name: 'ping',       aliases: [],                                    category: 'utility', slash: true,  prefix: false, description: 'Check bot latency',        staffOnly: false, cooldownSeconds: 2 },
  { name: 'prefix',     aliases: [],                                    category: 'utility', slash: true,  prefix: true,  description: 'View or change the prefix', staffOnly: false, cooldownSeconds: 2 },
  { name: 'server',     aliases: ['serverinfo','sinfo','si','guild'],   category: 'utility', slash: true,  prefix: true,  description: 'Show server info',         staffOnly: false, cooldownSeconds: 2 },
  { name: 'user',       aliases: ['userinfo','uinfo','ui','whois'],     category: 'utility', slash: true,  prefix: true,  description: 'Show user info',           staffOnly: false, cooldownSeconds: 2 },
  { name: 'avatar',     aliases: ['av'],                                category: 'utility', slash: true,  prefix: true,  description: 'Show a user\'s avatar',    staffOnly: false, cooldownSeconds: 2 },
  { name: 'modules',    aliases: [],                                    category: 'utility', slash: true,  prefix: false, description: 'Manage bot modules',       staffOnly: true,  cooldownSeconds: 2 },
  { name: 'embed',      aliases: [],                                    category: 'utility', slash: true,  prefix: false, description: 'Create a custom embed',    staffOnly: true,  cooldownSeconds: 2 },
  { name: 'sticky',     aliases: [],                                    category: 'utility', slash: true,  prefix: false, description: 'Manage sticky messages',   staffOnly: true,  cooldownSeconds: 2 },
  { name: 'starboard',  aliases: [],                                    category: 'utility', slash: true,  prefix: false, description: 'Configure starboard',      staffOnly: true,  cooldownSeconds: 2 },
  { name: 'persist',    aliases: [],                                    category: 'utility', slash: true,  prefix: false, description: 'Configure member persistence (restore roles/nickname on rejoin)', staffOnly: true,  cooldownSeconds: 2 },
  { name: 'doctor',     aliases: [],                                    category: 'utility', slash: true,  prefix: false, description: 'Run a bot health check',   staffOnly: true,  cooldownSeconds: 5 },

  // ─── MODERATION ─────────────────────────────────────────────────────────────
  { name: 'kick',     aliases: [], category: 'moderation', slash: true, prefix: true,  description: 'Kick a member',              staffOnly: false, cooldownSeconds: 2 },
  { name: 'ban',      aliases: [], category: 'moderation', slash: true, prefix: true,  description: 'Ban a member',               staffOnly: false, cooldownSeconds: 2 },
  { name: 'timeout',  aliases: [], category: 'moderation', slash: true, prefix: true,  description: 'Timeout a member',           staffOnly: false, cooldownSeconds: 2 },
  { name: 'warn',     aliases: [], category: 'moderation', slash: true, prefix: true,  description: 'Warn a member',              staffOnly: false, cooldownSeconds: 2 },
  { name: 'clear',    aliases: [], category: 'moderation', slash: true, prefix: true,  description: 'Bulk delete messages',       staffOnly: false, cooldownSeconds: 2 },
  { name: 'logs',     aliases: [], category: 'moderation', slash: true, prefix: false, description: 'Configure logging',          staffOnly: true,  cooldownSeconds: 2 },
  { name: 'modlogs',  aliases: [], category: 'moderation', slash: true, prefix: false, description: 'Configure mod log channel',  staffOnly: true,  cooldownSeconds: 2 },
  { name: 'modcase',  aliases: [], category: 'moderation', slash: true, prefix: false, description: 'View or edit a mod case',    staffOnly: true,  cooldownSeconds: 2 },
  { name: 'automod',  aliases: [], category: 'moderation', slash: true, prefix: false, description: 'Configure automod',          staffOnly: true,  cooldownSeconds: 2 },
  { name: 'verify',   aliases: [], category: 'moderation', slash: true, prefix: false, description: 'Configure verification',     staffOnly: true,  cooldownSeconds: 2 },

  // ─── MUSIC ──────────────────────────────────────────────────────────────────
  { name: 'music',  aliases: [],          category: 'music', slash: true,  prefix: true,  description: 'Music command group',      staffOnly: false, cooldownSeconds: 2 },
  { name: 'play',   aliases: ['p'],       category: 'music', slash: false, prefix: true,  description: 'Play a track',             staffOnly: false, cooldownSeconds: 2 },
  { name: 'now',    aliases: ['np'],      category: 'music', slash: false, prefix: true,  description: 'Now playing',              staffOnly: false, cooldownSeconds: 2 },
  { name: 'queue',  aliases: ['q'],       category: 'music', slash: false, prefix: true,  description: 'Show the queue',           staffOnly: false, cooldownSeconds: 2 },
  { name: 'skip',   aliases: [],          category: 'music', slash: false, prefix: true,  description: 'Skip a track',             staffOnly: false, cooldownSeconds: 2 },
  { name: 'pause',  aliases: [],          category: 'music', slash: false, prefix: true,  description: 'Pause playback',           staffOnly: false, cooldownSeconds: 2 },
  { name: 'resume', aliases: [],          category: 'music', slash: false, prefix: true,  description: 'Resume playback',          staffOnly: false, cooldownSeconds: 2 },
  { name: 'stop',   aliases: [],          category: 'music', slash: false, prefix: true,  description: 'Stop and clear queue',     staffOnly: false, cooldownSeconds: 2 },
  { name: 'loop',   aliases: [],          category: 'music', slash: false, prefix: true,  description: 'Set loop mode',            staffOnly: false, cooldownSeconds: 2 },
  { name: '247',    aliases: [],          category: 'music', slash: false, prefix: true,  description: 'Toggle 24/7 mode',         staffOnly: true,  cooldownSeconds: 2 },
  { name: 'join',   aliases: ['j'],       category: 'music', slash: false, prefix: true,  description: 'Join your voice channel',  staffOnly: false, cooldownSeconds: 2 },
  { name: 'leave',  aliases: [],          category: 'music', slash: false, prefix: true,  description: 'Leave voice channel',      staffOnly: true,  cooldownSeconds: 2 },

  // ─── TICKETS ────────────────────────────────────────────────────────────────
  { name: 'ticket',      aliases: [], category: 'tickets', slash: true, prefix: false, description: 'Manage ticket system',      staffOnly: true,  cooldownSeconds: 2 },
  { name: 'ticket-done', aliases: [], category: 'tickets', slash: true, prefix: false, description: 'Close a ticket',           staffOnly: false, cooldownSeconds: 2 },
  { name: 'transcript',  aliases: [], category: 'tickets', slash: true, prefix: false, description: 'Export ticket transcript',  staffOnly: true,  cooldownSeconds: 5 },

  // ─── ROLES ──────────────────────────────────────────────────────────────────
  { name: 'role',      aliases: [], category: 'roles', slash: true, prefix: false, description: 'Manage roles',        staffOnly: true,  cooldownSeconds: 2 },
  { name: 'rolepanel', aliases: [], category: 'roles', slash: true, prefix: false, description: 'Manage role panels',  staffOnly: true,  cooldownSeconds: 2 },

  // ─── GREET ──────────────────────────────────────────────────────────────────
  { name: 'greet', aliases: [], category: 'greet', slash: true, prefix: false, description: 'Configure welcome messages', staffOnly: true, cooldownSeconds: 2 },
  { name: 'leave', aliases: [], category: 'greet', slash: true, prefix: false, description: 'Configure leave messages',   staffOnly: true, cooldownSeconds: 2 },

  // ─── GIVEAWAY ───────────────────────────────────────────────────────────────
  { name: 'giveaway', aliases: [], category: 'giveaway', slash: true, prefix: false, description: 'Manage giveaways', staffOnly: true, cooldownSeconds: 2 },

  // ─── ROOMS ──────────────────────────────────────────────────────────────────
  { name: 'room', aliases: [], category: 'rooms', slash: true, prefix: false, description: 'Configure temp voice rooms', staffOnly: true, cooldownSeconds: 2 },

  // ─── DEV ────────────────────────────────────────────────────────────────────
  { name: 'dev', aliases: [], category: 'dev', slash: true, prefix: false, description: 'Developer tools', staffOnly: false, cooldownSeconds: 1 },
];

// ─── Derived lookup maps ─────────────────────────────────────────────────────

/** Map of every name/alias → manifest entry (for fast O(1) lookup) */
const COMMAND_MAP = new Map();
for (const entry of COMMAND_MANIFEST) {
  COMMAND_MAP.set(entry.name, entry);
  for (const alias of entry.aliases) {
    COMMAND_MAP.set(alias, entry);
  }
}

/** Set of all names that have slash parity */
const SLASH_COMMANDS = new Set(COMMAND_MANIFEST.filter((c) => c.slash).map((c) => c.name));

/** Set of all names/aliases that are available via prefix */
const PREFIX_COMMANDS = new Set();
for (const entry of COMMAND_MANIFEST.filter((c) => c.prefix)) {
  PREFIX_COMMANDS.add(entry.name);
  for (const alias of entry.aliases) PREFIX_COMMANDS.add(alias);
}

/**
 * Look up a command entry by name or alias.
 * @param {string} nameOrAlias
 * @returns {object|undefined}
 */
function getCommandMeta(nameOrAlias) {
  return COMMAND_MAP.get(nameOrAlias);
}

/**
 * Get all commands for a given category.
 * @param {string} category
 * @returns {object[]}
 */
function getCommandsByCategory(category) {
  return COMMAND_MANIFEST.filter((c) => c.category === category);
}

module.exports = {
  COMMAND_MANIFEST,
  COMMAND_MAP,
  SLASH_COMMANDS,
  PREFIX_COMMANDS,
  getCommandMeta,
  getCommandsByCategory,
};
