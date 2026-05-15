/**
 * Regression tests — Command manifest parity
 * Verifies that COMMAND_MANIFEST is internally consistent and that
 * all lookup helpers return the correct data.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COMMAND_MANIFEST,
  COMMAND_MAP,
  SLASH_COMMANDS,
  PREFIX_COMMANDS,
  getCommandMeta,
  getCommandsByCategory,
} = require('../src/shared/commandManifest');

// ── Structural integrity ──────────────────────────────────────────────────────

test('COMMAND_MANIFEST is a non-empty array', () => {
  assert.ok(Array.isArray(COMMAND_MANIFEST));
  assert.ok(COMMAND_MANIFEST.length > 0);
});

test('every manifest entry has required fields', () => {
  const required = ['name', 'aliases', 'category', 'slash', 'prefix', 'description', 'cooldownSeconds'];
  for (const entry of COMMAND_MANIFEST) {
    for (const field of required) {
      assert.ok(field in entry, `Entry "${entry.name}" missing field: ${field}`);
    }
    assert.ok(typeof entry.name === 'string' && entry.name.length > 0, `Entry missing valid name`);
    assert.ok(Array.isArray(entry.aliases), `Entry "${entry.name}" aliases must be an array`);
    assert.ok(typeof entry.slash === 'boolean', `Entry "${entry.name}" slash must be boolean`);
    assert.ok(typeof entry.prefix === 'boolean', `Entry "${entry.name}" prefix must be boolean`);
    assert.ok(typeof entry.cooldownSeconds === 'number', `Entry "${entry.name}" cooldownSeconds must be number`);
  }
});

test('no duplicate canonical names in manifest (per category)', () => {
  // Names may repeat across categories (e.g., "leave" in music and greet) — that is intentional.
  // But within the same category there must be no duplicates.
  const seen = new Map(); // "category:name" -> true
  for (const entry of COMMAND_MANIFEST) {
    const key = `${entry.category}:${entry.name}`;
    assert.ok(!seen.has(key), `Duplicate entry in manifest: ${key}`);
    seen.set(key, true);
  }
});

// ── COMMAND_MAP lookup ────────────────────────────────────────────────────────

test('COMMAND_MAP resolves canonical names', () => {
  assert.ok(COMMAND_MAP.has('kick'));
  assert.ok(COMMAND_MAP.has('hug'));
  assert.ok(COMMAND_MAP.has('play'));
  assert.ok(COMMAND_MAP.has('help'));
});

test('COMMAND_MAP resolves aliases to their canonical entry', () => {
  const hugEntry = COMMAND_MAP.get('h');
  assert.ok(hugEntry, 'alias "h" should resolve');
  assert.equal(hugEntry.name, 'hug');

  const playEntry = COMMAND_MAP.get('p');
  assert.ok(playEntry, 'alias "p" should resolve');
  assert.equal(playEntry.name, 'play');

  const avatarEntry = COMMAND_MAP.get('av');
  assert.ok(avatarEntry, 'alias "av" should resolve');
  assert.equal(avatarEntry.name, 'avatar');
});

// ── getCommandMeta ────────────────────────────────────────────────────────────

test('getCommandMeta returns entry for known command', () => {
  const meta = getCommandMeta('ban');
  assert.ok(meta);
  assert.equal(meta.name, 'ban');
  assert.equal(meta.category, 'moderation');
});

test('getCommandMeta returns entry for alias', () => {
  const meta = getCommandMeta('np');
  assert.ok(meta);
  assert.equal(meta.name, 'now');
});

test('getCommandMeta returns undefined for unknown command', () => {
  assert.equal(getCommandMeta('doesnotexist'), undefined);
});

// ── getCommandsByCategory ─────────────────────────────────────────────────────

test('getCommandsByCategory returns all commands in a category', () => {
  const fun = getCommandsByCategory('fun');
  assert.ok(fun.length > 0);
  for (const entry of fun) assert.equal(entry.category, 'fun');
});

test('getCommandsByCategory returns empty array for unknown category', () => {
  const result = getCommandsByCategory('nonexistent');
  assert.deepEqual(result, []);
});

// ── SLASH_COMMANDS / PREFIX_COMMANDS sets ─────────────────────────────────────

test('SLASH_COMMANDS includes expected slash commands', () => {
  assert.ok(SLASH_COMMANDS.has('kick'));
  assert.ok(SLASH_COMMANDS.has('ban'));
  assert.ok(SLASH_COMMANDS.has('music'));
  assert.ok(SLASH_COMMANDS.has('ticket'));
});

test('PREFIX_COMMANDS includes expected prefix commands and aliases', () => {
  // canonical names
  assert.ok(PREFIX_COMMANDS.has('kick'));
  assert.ok(PREFIX_COMMANDS.has('play'));
  assert.ok(PREFIX_COMMANDS.has('hug'));
  // aliases
  assert.ok(PREFIX_COMMANDS.has('p'));   // play alias
  assert.ok(PREFIX_COMMANDS.has('h'));   // hug alias
  assert.ok(PREFIX_COMMANDS.has('np'));  // now alias
});

test('slash-only commands are not in PREFIX_COMMANDS', () => {
  // /ticket is slash-only
  const ticketEntry = getCommandMeta('ticket');
  assert.ok(ticketEntry);
  assert.equal(ticketEntry.prefix, false);
  assert.ok(!PREFIX_COMMANDS.has('ticket'));
});

// ── Known parity pairs ────────────────────────────────────────────────────────

const PARITY_PAIRS = [
  // Commands that must exist as BOTH slash and prefix
  { name: 'kick',    slash: true, prefix: true },
  { name: 'ban',     slash: true, prefix: true },
  { name: 'timeout', slash: true, prefix: true },
  { name: 'warn',    slash: true, prefix: true },
  { name: 'clear',   slash: true, prefix: true },
  { name: 'hug',     slash: true, prefix: true },
  { name: 'help',    slash: true, prefix: true },
  { name: 'avatar',  slash: true, prefix: true },
  { name: 'server',  slash: true, prefix: true },
  { name: 'user',    slash: true, prefix: true },
  // Slash-only
  { name: 'ticket',     slash: true, prefix: false },
  { name: 'rolepanel',  slash: true, prefix: false },
  { name: 'giveaway',   slash: true, prefix: false },
];

for (const { name, slash, prefix } of PARITY_PAIRS) {
  test(`parity: "${name}" slash=${slash} prefix=${prefix}`, () => {
    const meta = getCommandMeta(name);
    assert.ok(meta, `"${name}" must exist in manifest`);
    assert.equal(meta.slash, slash, `"${name}" slash mismatch`);
    assert.equal(meta.prefix, prefix, `"${name}" prefix mismatch`);
  });
}
