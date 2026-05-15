/**
 * Regression tests — Moderation core flows
 * Covers: addWarn / listWarns / removeWarn / clearWarns + pickWarnLevel logic
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// ── Minimal in-memory db stub ─────────────────────────────────────────────────
const store = new Map();
const db = {
  async get(key) { return store.get(key) ?? null; },
  async set(key, value) { store.set(key, value); },
  async delete(key) { store.delete(key); },
};

// Patch the db module before requiring warn utils
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('/db') || request.endsWith('\\db')) return { db };
  return originalLoad.apply(this, arguments);
};

const { addWarn, listWarns, removeWarn, clearWarns } = require('../src/utils/warns');

// ── Helper ────────────────────────────────────────────────────────────────────
function pickWarnLevel(levels, count) {
  if (!Array.isArray(levels)) return null;
  const clean = levels
    .map((l) => ({ threshold: Number(l.threshold), durationMs: Number(l.durationMs) }))
    .filter((l) => Number.isFinite(l.threshold) && l.threshold > 0 && Number.isFinite(l.durationMs) && l.durationMs > 0)
    .sort((a, b) => a.threshold - b.threshold);
  let chosen = null;
  for (const l of clean) if (count >= l.threshold) chosen = l;
  return chosen;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('addWarn creates a warn with required fields', async () => {
  store.clear();
  const w = await addWarn('g1', 'u1', 'mod1', 'spamming');
  assert.ok(w.id, 'warn should have an id');
  assert.equal(w.reason, 'spamming');
  assert.equal(w.moderatorId, 'mod1');
  assert.ok(typeof w.createdAt === 'number', 'createdAt should be a number');
});

test('listWarns returns empty array for unknown user', async () => {
  store.clear();
  const warns = await listWarns('g1', 'nobody');
  assert.deepEqual(warns, []);
});

test('listWarns accumulates multiple warns', async () => {
  store.clear();
  await addWarn('g1', 'u2', 'mod1', 'reason 1');
  await addWarn('g1', 'u2', 'mod1', 'reason 2');
  await addWarn('g1', 'u2', 'mod1', 'reason 3');
  const warns = await listWarns('g1', 'u2');
  assert.equal(warns.length, 3);
});

test('removeWarn deletes a specific warn by id', async () => {
  store.clear();
  const w1 = await addWarn('g1', 'u3', 'mod1', 'first');
  const w2 = await addWarn('g1', 'u3', 'mod1', 'second');
  const removed = await removeWarn('g1', 'u3', w1.id);
  assert.equal(removed, true, 'should return true when warn was found');
  const remaining = await listWarns('g1', 'u3');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, w2.id);
});

test('removeWarn returns false for unknown warnId', async () => {
  store.clear();
  await addWarn('g1', 'u4', 'mod1', 'something');
  const removed = await removeWarn('g1', 'u4', 'nonexistent-id');
  assert.equal(removed, false);
});

test('clearWarns empties all warns for a user', async () => {
  store.clear();
  await addWarn('g1', 'u5', 'mod1', 'a');
  await addWarn('g1', 'u5', 'mod1', 'b');
  await clearWarns('g1', 'u5');
  const warns = await listWarns('g1', 'u5');
  assert.deepEqual(warns, []);
});

test('warns are isolated per guild', async () => {
  store.clear();
  await addWarn('g1', 'u6', 'mod1', 'guild 1 warn');
  await addWarn('g2', 'u6', 'mod1', 'guild 2 warn');
  const g1warns = await listWarns('g1', 'u6');
  const g2warns = await listWarns('g2', 'u6');
  assert.equal(g1warns.length, 1);
  assert.equal(g2warns.length, 1);
  assert.notEqual(g1warns[0].id, g2warns[0].id);
});

// ── pickWarnLevel tests ───────────────────────────────────────────────────────

test('pickWarnLevel returns null for empty levels', () => {
  assert.equal(pickWarnLevel([], 5), null);
});

test('pickWarnLevel returns null when count below all thresholds', () => {
  const levels = [{ threshold: 5, durationMs: 60000 }, { threshold: 10, durationMs: 120000 }];
  assert.equal(pickWarnLevel(levels, 3), null);
});

test('pickWarnLevel returns the highest applicable threshold', () => {
  const levels = [
    { threshold: 3, durationMs: 60000 },
    { threshold: 7, durationMs: 120000 },
    { threshold: 15, durationMs: 300000 },
  ];
  const result = pickWarnLevel(levels, 8);
  assert.equal(result.threshold, 7);
});

test('pickWarnLevel returns highest level when count exceeds all', () => {
  const levels = [{ threshold: 3, durationMs: 60000 }, { threshold: 10, durationMs: 300000 }];
  const result = pickWarnLevel(levels, 20);
  assert.equal(result.threshold, 10);
});

test('pickWarnLevel ignores invalid entries', () => {
  const levels = [
    { threshold: -1, durationMs: 60000 },   // invalid threshold
    { threshold: 5, durationMs: -100 },      // invalid duration
    { threshold: 3, durationMs: 60000 },     // valid
  ];
  const result = pickWarnLevel(levels, 5);
  assert.equal(result.threshold, 3);
});
