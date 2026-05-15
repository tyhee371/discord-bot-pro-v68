/**
 * Regression tests — Giveaway store + helper logic
 * Covers: getGiveaway / saveGiveaway / deleteGiveaway / index helpers
 *         parseDuration / formatTimeLeft / pickWinners
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory db stub ─────────────────────────────────────────────────────────
const store = new Map();
const db = {
  async get(key) { return store.get(key) ?? null; },
  async set(key, value) { store.set(key, value); },
  async delete(key) { store.delete(key); },
};

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('/db') || request.endsWith('\\db')) return { db };
  return originalLoad.apply(this, arguments);
};

const { getGiveaway, saveGiveaway, deleteGiveaway, addToIndex, removeFromIndex, getGuildGiveawayIds } = require('../src/utils/giveawayStore');
const { parseDuration, formatTimeLeft, pickWinners } = require('../src/utils/giveawayHelpers');

// ── getGiveaway / saveGiveaway / deleteGiveaway ───────────────────────────────

test('getGiveaway returns null for unknown id', async () => {
  store.clear();
  const result = await getGiveaway('msg-unknown');
  assert.equal(result, null);
});

test('saveGiveaway and getGiveaway round-trip', async () => {
  store.clear();
  const giveaway = { id: 'msg-1', prize: 'Nitro', winnerCount: 1, entries: [], ended: false, guildId: 'g1', channelId: 'ch1', endTime: Date.now() + 60000 };
  await saveGiveaway(giveaway);
  const result = await getGiveaway('msg-1');
  assert.deepEqual(result, giveaway);
});

test('saveGiveaway throws when giveaway has no id', async () => {
  store.clear();
  await assert.rejects(() => saveGiveaway({ prize: 'No ID' }), /missing id/i);
});

test('saveGiveaway overwrites existing giveaway', async () => {
  store.clear();
  await saveGiveaway({ id: 'msg-2', ended: false });
  await saveGiveaway({ id: 'msg-2', ended: true });
  const result = await getGiveaway('msg-2');
  assert.equal(result.ended, true);
});

test('deleteGiveaway removes the giveaway', async () => {
  store.clear();
  await saveGiveaway({ id: 'msg-3', prize: 'Test' });
  await deleteGiveaway('msg-3');
  const result = await getGiveaway('msg-3');
  assert.equal(result, null);
});

// ── Index helpers ─────────────────────────────────────────────────────────────

test('getGuildGiveawayIds returns empty array initially', async () => {
  store.clear();
  const ids = await getGuildGiveawayIds('g1');
  assert.deepEqual(ids, []);
});

test('addToIndex and getGuildGiveawayIds round-trip', async () => {
  store.clear();
  await addToIndex('g1', 'msg-A');
  await addToIndex('g1', 'msg-B');
  const ids = await getGuildGiveawayIds('g1');
  assert.ok(ids.includes('msg-A'));
  assert.ok(ids.includes('msg-B'));
  assert.equal(ids.length, 2);
});

test('addToIndex deduplicates entries', async () => {
  store.clear();
  await addToIndex('g1', 'msg-A');
  await addToIndex('g1', 'msg-A');
  const ids = await getGuildGiveawayIds('g1');
  assert.equal(ids.filter((id) => id === 'msg-A').length, 1);
});

test('removeFromIndex removes a specific entry', async () => {
  store.clear();
  await addToIndex('g1', 'msg-A');
  await addToIndex('g1', 'msg-B');
  await removeFromIndex('g1', 'msg-A');
  const ids = await getGuildGiveawayIds('g1');
  assert.ok(!ids.includes('msg-A'));
  assert.ok(ids.includes('msg-B'));
});

test('indexes are isolated per guild', async () => {
  store.clear();
  await addToIndex('g1', 'msg-X');
  await addToIndex('g2', 'msg-Y');
  const g1 = await getGuildGiveawayIds('g1');
  const g2 = await getGuildGiveawayIds('g2');
  assert.ok(g1.includes('msg-X'));
  assert.ok(!g1.includes('msg-Y'));
  assert.ok(g2.includes('msg-Y'));
  assert.ok(!g2.includes('msg-X'));
});

// ── parseDuration ─────────────────────────────────────────────────────────────

test('parseDuration returns null for empty input', () => {
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration(null), null);
  assert.equal(parseDuration(undefined), null);
});

test('parseDuration parses seconds', () => {
  assert.equal(parseDuration('30s'), 30_000);
});

test('parseDuration parses minutes', () => {
  assert.equal(parseDuration('5m'), 300_000);
});

test('parseDuration parses hours', () => {
  assert.equal(parseDuration('2h'), 7_200_000);
});

test('parseDuration parses days', () => {
  assert.equal(parseDuration('1d'), 86_400_000);
});

test('parseDuration parses compound durations', () => {
  assert.equal(parseDuration('1h30m'), 5_400_000);
  assert.equal(parseDuration('2d12h'), 2 * 86_400_000 + 12 * 3_600_000);
});

test('parseDuration returns null for invalid input', () => {
  assert.equal(parseDuration('abc'), null);
  assert.equal(parseDuration('0s'), null);
});

// ── pickWinners ───────────────────────────────────────────────────────────────

test('pickWinners returns empty array for empty entries', () => {
  assert.deepEqual(pickWinners([], 1), []);
});

test('pickWinners picks the correct number of winners', () => {
  const entries = ['u1', 'u2', 'u3', 'u4', 'u5'];
  const winners = pickWinners(entries, 2);
  assert.equal(winners.length, 2);
  for (const w of winners) assert.ok(entries.includes(w));
});

test('pickWinners caps at available entries', () => {
  const entries = ['u1', 'u2'];
  const winners = pickWinners(entries, 5);
  assert.equal(winners.length, 2);
});

test('pickWinners returns unique winners', () => {
  const entries = ['u1', 'u2', 'u3', 'u4', 'u5'];
  const winners = pickWinners(entries, 3);
  const unique = new Set(winners);
  assert.equal(unique.size, 3);
});

// ── formatTimeLeft ────────────────────────────────────────────────────────────

test('formatTimeLeft returns "Ended" for past time', () => {
  const result = formatTimeLeft(Date.now() - 1000);
  assert.equal(result, 'Ended');
});

test('formatTimeLeft returns a non-empty string for future time', () => {
  const result = formatTimeLeft(Date.now() + 90_000); // 1m 30s
  assert.ok(typeof result === 'string' && result.length > 0);
  assert.notEqual(result, 'Ended');
});
