const { EmbedBuilder } = require('discord.js');
const { getGuildSettings } = require('./settings');

// NOTE: This file serves TWO callers:
// 1) Prefix help in messageCreate: buildHelpEmbeds(client, guildId)
// 2) Interactive help menu component: discoverSlashCommands / discoverPrefixCommands

function extractSubcommands(json) {
  const subcommands = [];
  const opts = Array.isArray(json?.options) ? json.options : [];
  for (const opt of opts) {
    // 1 = SUB_COMMAND, 2 = SUB_COMMAND_GROUP
    if (opt?.type === 1) {
      subcommands.push({ name: opt.name, description: opt.description || '' });
    } else if (opt?.type === 2 && Array.isArray(opt.options)) {
      for (const sub of opt.options) {
        if (sub?.type === 1) {
          subcommands.push({ name: `${opt.name} ${sub.name}`, description: sub.description || '' });
        }
      }
    }
  }
  return subcommands;
}

/**
 * Return a compact, serializable list of slash commands for help rendering.
 * @param {import('discord.js').Client} client
 */
function discoverSlashCommands(client) {
  if (!client?.commands?.values) return [];
  const out = [];
  for (const cmd of client.commands.values()) {
    try {
      const json = cmd?.data?.toJSON?.();
      if (!json?.name) continue;
      out.push({
        name: json.name,
        description: json.description || '',
        default_member_permissions: json.default_member_permissions,
        staffOnly: Boolean(cmd.staffOnly),
        devOnly: Boolean(cmd.devOnly),
        subcommands: extractSubcommands(json),
      });
    } catch {
      // ignore malformed commands
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Return a compact list of prefix commands used by the bot.
 * The bot's prefix command handling is implemented inline in messageCreate,
 * so we keep this list as a curated definition.
 */
function discoverPrefixCommands() {
  return [
    { name: 'help', description: 'Show this help menu in your DMs.' },

    { name: 'play <name|url>', description: 'Play / queue a song or playlist.' },
    { name: 'p <name|url>', description: 'Alias for play.' },
    { name: 'join', description: 'Make the bot join your voice channel.' },
    { name: 'now', description: 'Show what is playing now.' },
    { name: 'np', description: 'Alias for now.' },
    { name: 'queue [page]', description: 'Show the queue (10 per page).' },
    { name: 'q [page]', description: 'Alias for queue.' },
    { name: 'skip [pos]', description: 'Skip current track or jump to queue position.' },
    { name: 'pause', description: 'Pause playback.' },
    { name: 'resume', description: 'Resume playback.' },
    { name: 'stop', description: 'Stop and clear queue.' },
    { name: 'loop [off|track|queue]', description: 'Set/cycle loop mode.' },
    { name: 'vol <0.0-2.0>', description: 'Set volume.' },
    { name: 'volume <0.0-2.0>', description: 'Alias for vol.' },
    { name: '247 on|off', description: 'Toggle 24/7 mode.' },
    { name: 'leave', description: 'Disconnect from voice.' },

    { name: 'clear <all|number> [#channel]', description: '(Mod) Clear messages in a channel.' },
    { name: 'purge <all|number> [#channel]', description: '(Mod) Alias for clear.' },

    { name: 'avatar [@user|id] [global]', description: 'Show a user avatar (server avatar by default).' },
    { name: 'server', description: 'Show server info.' },
    { name: 'guild', description: 'Alias for server info.' },
    { name: 'user [@user|id]', description: 'Show user info.' },
    { name: 'whois [@user|id]', description: 'Alias for user info.' },

    // Fun actions
    { name: 'hug [@user|id]', description: 'Hug someone (GIF).' },
    { name: 'h [@user|id]', description: 'Alias for hug.' },
    { name: 'kiss [@user|id]', description: 'Kiss someone (GIF).' },
    { name: 'k [@user|id]', description: 'Alias for kiss.' },
    { name: 'slap [@user|id]', description: 'Slap someone (GIF).' },
    { name: 'pat [@user|id]', description: 'Pat someone (GIF).' },
    { name: 'cuddle [@user|id]', description: 'Cuddle someone (GIF).' },
    { name: 'poke [@user|id]', description: 'Poke someone (GIF).' },
    { name: 'bite [@user|id]', description: 'Bite someone (GIF).' },
    { name: 'tickle [@user|id]', description: 'Tickle someone (GIF).' },
    { name: 'wave [@user|id]', description: 'Wave at someone (GIF).' },
    { name: 'dance [@user|id]', description: 'Dance (GIF).' },
    { name: 'blush [@user|id]', description: 'Blush (GIF).' },
    { name: 'cry [@user|id]', description: 'Cry (GIF).' },
    { name: 'smile [@user|id]', description: 'Smile (GIF).' },

    { name: 'prefix', description: 'Show current prefix.' },
    { name: 'prefix set <new>', description: 'Change prefix (staff only).' },
    { name: 'prefix reset', description: 'Reset prefix to "!". (staff only)' },
  ];
}

function isStaffCommand(command) {
  if (command.staffOnly) return true;

  try {
    const json = command.data?.toJSON?.();
    const perms = json?.default_member_permissions;
    // If default_member_permissions is set and not "0", it's a staff command.
    if (perms && perms !== '0') return true;
  } catch {}

  return false;
}

function flattenCommand(command) {
  const out = [];
  const json = command.data.toJSON();
  const baseName = `/${json.name}`;

  if (!json.options || json.options.length === 0) {
    out.push({ name: baseName, description: json.description || '' });
    return out;
  }

  for (const opt of json.options) {
    // 1 = SUB_COMMAND, 2 = SUB_COMMAND_GROUP
    if (opt.type === 1) {
      out.push({ name: `${baseName} ${opt.name}`, description: opt.description || '' });
    } else if (opt.type === 2 && Array.isArray(opt.options)) {
      for (const sub of opt.options) {
        if (sub.type === 1) {
          out.push({ name: `${baseName} ${opt.name} ${sub.name}`, description: sub.description || '' });
        }
      }
    }
  }

  if (out.length === 0) out.push({ name: baseName, description: json.description || '' });
  return out;
}

function formatLines(items) {
  return items
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(i => `\`${i.name}\` — ${i.description || 'No description.'}`)
    .join('\n');
}

function splitFieldValue(text, maxLen = 1024) {
  if (!text) return [''];
  if (text.length <= maxLen) return [text];
  const lines = text.split('\n');
  const chunks = [];
  let buf = '';
  for (const line of lines) {
    if (!buf) {
      buf = line;
      continue;
    }
    if ((buf + '\n' + line).length > maxLen) {
      chunks.push(buf);
      buf = line;
    } else {
      buf += '\n' + line;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function getPrefixCommandCatalog(prefix) {
  const p = prefix || '!';

  // Admin / moderation (prefix)
  const staff = [
    {
      name: 'kick <@user> [reason]',
      aliases: [],
      description: 'Kick a member (reason optional).',
    },
    {
      name: 'ban <@user> [reason]',
      aliases: [],
      description: 'Ban a member (reason optional).',
    },
    {
      name: 'timeout <@user> <duration> [reason]',
      aliases: [],
      description: 'Timeout a member (e.g. 10m, 2h, 1d). Reason optional.',
    },
    {
      name: 'warn <@user> [reason]',
      aliases: [],
      description: 'Add a warning to a member (reason optional).',
    },
    {
      name: 'clear <1-100> [reason]',
      aliases: [],
      description: 'Bulk delete messages (reason optional).',
    },
  ];

  // User commands (prefix) - includes music shortcuts + fun actions
  const user = [
    { name: 'help', aliases: [], description: 'Send the help menu to your DMs.' },

    { name: 'play <name|url>', aliases: ['p'], description: 'Play / queue a song or playlist.' },
    { name: 'join', aliases: [], description: 'Make the bot join your voice channel.' },
    { name: 'now', aliases: ['np'], description: 'Show what is playing now.' },
    { name: 'queue [page]', aliases: ['q'], description: 'Show the queue (10 per page).' },
    { name: 'skip [pos]', aliases: [], description: 'Skip current track or jump to a queue position.' },
    { name: 'pause', aliases: [], description: 'Pause playback.' },
    { name: 'resume', aliases: [], description: 'Resume playback.' },
    { name: 'stop', aliases: [], description: 'Stop playback and clear the queue.' },
    { name: 'leave', aliases: [], description: 'Make the bot leave the voice channel.' },
    { name: 'volume <0-200>', aliases: [], description: 'Set volume.' },

    // Fun actions
    { name: 'hug <@user>', aliases: ['h'], description: 'Hug someone.' },
    { name: 'kiss <@user>', aliases: ['k'], description: 'Kiss someone.' },
    { name: 'slap <@user>', aliases: [], description: 'Slap someone.' },
    { name: 'pat <@user>', aliases: [], description: 'Pat someone.' },
    { name: 'cuddle <@user>', aliases: [], description: 'Cuddle someone.' },
    { name: 'poke <@user>', aliases: [], description: 'Poke someone.' },
    { name: 'bite <@user>', aliases: [], description: 'Bite someone.' },
    { name: 'tickle <@user>', aliases: [], description: 'Tickle someone.' },
    { name: 'wave', aliases: [], description: 'Wave.' },
    { name: 'dance', aliases: [], description: 'Dance.' },
    { name: 'blush', aliases: [], description: 'Blush.' },
    { name: 'cry', aliases: [], description: 'Cry.' },
    { name: 'smile', aliases: [], description: 'Smile.' },
  ];

  const decorate = (arr) =>
    arr.map((c) => ({
      ...c,
      // store prefix separately so callers can format
      _prefix: p,
    }));

  return { staff: decorate(staff), user: decorate(user) };
}

function formatPrefixLine(cmd) {
  const p = cmd._prefix || '!';
  const name = String(cmd.name || '').trim();
  const aliases = Array.isArray(cmd.aliases) ? cmd.aliases.filter(Boolean) : [];
  const aliasPart = aliases.length
    ? ` (alias - ${aliases.map((a) => `\`${p}${a}\``).join(', ')})`
    : '';
  const desc = (cmd.description || '').trim();
  return `\`${p}${name}\`${aliasPart}: ${desc}`;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildPrefixHelpEmbeds(prefix) {
  const { staff, user } = getPrefixCommandCatalog(prefix);
  const embeds = [];

  const staffChunks = chunk(staff, 10);
  for (let i = 0; i < staffChunks.length; i += 1) {
    const title = i === 0 ? 'Admin/Moderation Commands' : 'Admin/Moderation Commands (cont)';
    embeds.push(
      new EmbedBuilder()
        .setTitle(title)
        .setDescription(staffChunks[i].map(formatPrefixLine).join('\n'))
    );
  }

  const userChunks = chunk(user, 10);
  for (let i = 0; i < userChunks.length; i += 1) {
    const title = i === 0 ? 'User Commands' : 'User Commands (cont)';
    embeds.push(
      new EmbedBuilder()
        .setTitle(title)
        .setDescription(userChunks[i].map(formatPrefixLine).join('\n'))
    );
  }

  return embeds;
}
function buildPrefixHelp(prefix) {
  const embeds = buildPrefixHelpEmbeds(prefix);
  // Keep legacy return type as string for any caller: join embed descriptions.
  return embeds.map((e) => `${e.data.title}\n${e.data.description}`).join('\n\n');
}


async function buildHelpEmbeds(client, guildId) {
  const settings = guildId ? await getGuildSettings(guildId) : {};
  const prefix = settings?.prefix ?? '!';
  // Only show PREFIX commands (as requested). Slash commands are intentionally hidden from help.
  return buildPrefixHelpEmbeds(prefix);
}


module.exports = {
  buildHelpEmbeds,
  buildPrefixHelpEmbeds,
  discoverSlashCommands,
  discoverPrefixCommands,
};
