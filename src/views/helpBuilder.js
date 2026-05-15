const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { ownerIds } = require('../config');

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toTitle(moduleKey) {
  const map = {
    moderation: 'Moderation',
    utility: 'Utility',
    music: 'Music',
    fun: 'Fun',
    tickets: 'Tickets',
    roles: 'Roles',
    greet: 'Greeting',
    rooms: 'Rooms',
    giveaway: 'Giveaway',
    dev: 'Developer',
  };
  return map[moduleKey] || 'Other';
}

function isStaffMember(member) {
  if (!member?.permissions?.has) return false;
  return (
    member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
    member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

function isDevUser(userId) {
  return ownerIds.includes(String(userId || ''));
}

function expandSlashEntries(json, command) {
  const entries = [];
  const base = `/${json.name}`;
  const options = Array.isArray(json.options) ? json.options : [];

  const pushEntry = (trigger, description) => {
    entries.push({
      source: 'slash',
      moduleKey: command.moduleKey || 'utility',
      audience: command.devOnly
        ? 'dev'
        : command.staffOnly || (json.default_member_permissions && json.default_member_permissions !== '0')
          ? 'staff'
          : 'public',
      trigger,
      description: (description || json.description || 'No description').trim(),
      commandKey: json.name,
      aliases: [],
    });
  };

  if (!options.length) {
    pushEntry(base, json.description);
    return entries;
  }

  let foundSubcommands = false;
  for (const opt of options) {
    if (opt?.type === 1) {
      foundSubcommands = true;
      pushEntry(`${base} ${opt.name}`, opt.description);
      continue;
    }
    if (opt?.type === 2 && Array.isArray(opt.options)) {
      for (const sub of opt.options) {
        if (sub?.type === 1) {
          foundSubcommands = true;
          pushEntry(`${base} ${opt.name} ${sub.name}`, sub.description);
        }
      }
    }
  }
  if (!foundSubcommands) pushEntry(base, json.description);
  return entries;
}

function discoverSlashManifest(client) {
  if (!client?.commands?.values) return [];
  const rows = [];
  for (const command of client.commands.values()) {
    try {
      const json = command?.data?.toJSON?.();
      if (!json?.name) continue;
      rows.push(...expandSlashEntries(json, command));
    } catch {
      // ignore invalid command modules
    }
  }
  return rows;
}

function buildPrefixManifest(prefix) {
  const p = prefix || '!';
  const m = (trigger, description, moduleKey, audience = 'public', aliases = []) => ({
    source: 'prefix',
    moduleKey,
    audience,
    trigger: `${p}${trigger}`,
    description,
    aliases: aliases.map((alias) => `${p}${alias}`),
    commandKey: trigger.split(' ')[0],
  });

  return [
    m('help', 'Send the help menu to your DMs.', 'utility'),
    m('prefix', 'Show current prefix or change it.', 'utility', 'staff'),
    m('avatar [@user|id] [global]', 'Show a user avatar.', 'utility'),
    m('server', 'Show server information.', 'utility', 'public', ['serverinfo', 'sinfo', 'si', 'guild']),
    m('user [@user|id]', 'Show user information.', 'utility', 'public', ['userinfo', 'whois']),

    m('kick <@user> [reason]', 'Kick a member.', 'moderation', 'staff'),
    m('ban <@user> [reason]', 'Ban a member.', 'moderation', 'staff'),
    m('timeout <@user> <duration> [reason]', 'Timeout a member.', 'moderation', 'staff'),
    m('warn <@user> [reason]', 'Warn a member.', 'moderation', 'staff'),
    m('clear <1-100> [reason]', 'Bulk delete messages.', 'moderation', 'staff'),

    m('play <name|url>', 'Play or queue songs.', 'music', 'public', ['p']),
    m('join', 'Join your voice channel.', 'music', 'public', ['j']),
    m('now', 'Show now playing.', 'music', 'public', ['np']),
    m('queue [page]', 'Show queue page.', 'music', 'public', ['q']),
    m('skip [pos]', 'Skip track or jump position.', 'music'),
    m('pause', 'Pause playback.', 'music'),
    m('resume', 'Resume playback.', 'music'),
    m('stop', 'Stop playback.', 'music'),
    m('loop [off|track|queue]', 'Change loop mode.', 'music'),
    m('247 on|off', 'Toggle 24/7 mode.', 'music'),
    m('leave', 'Disconnect from voice.', 'music'),

    m('hug [@user|id]', 'Hug someone.', 'fun', 'public', ['h']),
    m('kiss [@user|id]', 'Kiss someone.', 'fun', 'public', ['k']),
    m('slap [@user|id]', 'Slap someone.', 'fun'),
    m('pat [@user|id]', 'Pat someone.', 'fun'),
    m('cuddle [@user|id]', 'Cuddle someone.', 'fun'),
    m('poke [@user|id]', 'Poke someone.', 'fun'),
    m('bite [@user|id]', 'Bite someone.', 'fun'),
    m('tickle [@user|id]', 'Tickle someone.', 'fun'),
    m('wave', 'Wave.', 'fun'),
    m('dance', 'Dance.', 'fun'),
    m('blush', 'Blush.', 'fun'),
    m('cry', 'Cry.', 'fun'),
    m('smile', 'Smile.', 'fun'),
  ];
}

function classifyDuplicateCommands(manifest) {
  const byKey = new Map();
  for (const row of manifest) {
    const key = `${row.moduleKey}:${row.commandKey}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }
  return [...byKey.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([key, entries]) => ({ key, entries }));
}

function filterVisibleEntries(entries, { member, userId }) {
  const staff = isStaffMember(member);
  const dev = isDevUser(userId);
  return entries.filter((entry) => {
    if (entry.audience === 'dev') return dev;
    if (entry.audience === 'staff') return staff || dev;
    return true;
  });
}

function formatEntry(entry) {
  const aliasPart = entry.aliases?.length
    ? ` (aliases: ${entry.aliases.map((a) => `\`${a}\``).join(', ')})`
    : '';
  return `\`${entry.trigger}\` — ${entry.description}${aliasPart}`;
}

function buildEmbedsForSource(entries, sourceLabel) {
  const byModule = new Map();
  for (const entry of entries) {
    const title = toTitle(entry.moduleKey);
    if (!byModule.has(title)) byModule.set(title, []);
    byModule.get(title).push(entry);
  }

  const embeds = [];
  const modules = [...byModule.keys()].sort((a, b) => a.localeCompare(b));
  for (const moduleTitle of modules) {
    const lines = byModule.get(moduleTitle)
      .sort((a, b) => a.trigger.localeCompare(b.trigger))
      .map(formatEntry);
    const pages = chunk(lines, 10);
    pages.forEach((page, index) => {
      const suffix = pages.length > 1 ? ` (${index + 1}/${pages.length})` : '';
      embeds.push(
        new EmbedBuilder()
          .setTitle(`${sourceLabel} • ${moduleTitle}${suffix}`)
          .setDescription(page.join('\n')),
      );
    });
  }
  return embeds;
}

function buildAllHelpEmbeds({ client, prefix, member, userId }) {
  const slash = discoverSlashManifest(client);
  const prefixManifest = buildPrefixManifest(prefix);
  const manifest = [...slash, ...prefixManifest];
  const visible = filterVisibleEntries(manifest, { member, userId });
  const slashVisible = visible.filter((x) => x.source === 'slash');
  const prefixVisible = visible.filter((x) => x.source === 'prefix');
  const duplicates = classifyDuplicateCommands(visible);

  const embeds = [
    ...buildEmbedsForSource(slashVisible, 'Slash Commands'),
    ...buildEmbedsForSource(prefixVisible, 'Prefix Commands'),
  ];

  if (!embeds.length) {
    return [new EmbedBuilder().setTitle('Help').setDescription('No visible commands found for your role.')];
  }

  if (duplicates.length) {
    const lines = duplicates.slice(0, 10).map((dup) => {
      const names = dup.entries.map((e) => e.trigger).join(' / ');
      return `• ${names}`;
    });
    embeds.push(
      new EmbedBuilder()
        .setTitle('Command Compatibility Notes')
        .setDescription('Some commands exist in both slash and prefix formats:\n' + lines.join('\n')),
    );
  }

  return embeds;
}

module.exports = {
  buildAllHelpEmbeds,
  discoverSlashManifest,
  buildPrefixManifest,
  classifyDuplicateCommands,
};
