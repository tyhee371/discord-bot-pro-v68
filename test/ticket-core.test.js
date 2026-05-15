/**
 * Regression tests — Ticket store core flows
 * Covers: getTicket / setTicket / deleteTicket / nextSerial / category helpers
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

const { getTicket, setTicket, deleteTicket } = require('../src/utils/ticketData');
const { nextSerial, getCategoryIdForType, setCategoryIdForType, markTempCategory, isTempCategory, clearTempCategory } = require('../src/utils/ticketV2Store');

// ── getTicket / setTicket / deleteTicket ──────────────────────────────────────

test('getTicket returns null for unknown channel', async () => {
  store.clear();
  const result = await getTicket('g1', 'ch999');
  assert.equal(result, null);
});

test('setTicket stores and getTicket retrieves ticket data', async () => {
  store.clear();
  const data = { userId: 'u1', type: 'support', status: 'open', serial: '0001' };
  await setTicket('g1', 'ch1', data);
  const result = await getTicket('g1', 'ch1');
  assert.deepEqual(result, data);
});

test('setTicket overwrites existing ticket data', async () => {
  store.clear();
  await setTicket('g1', 'ch2', { status: 'open' });
  await setTicket('g1', 'ch2', { status: 'closed' });
  const result = await getTicket('g1', 'ch2');
  assert.equal(result.status, 'closed');
});

test('deleteTicket nullifies the ticket record', async () => {
  store.clear();
  await setTicket('g1', 'ch3', { status: 'open' });
  await deleteTicket('g1', 'ch3');
  const result = await getTicket('g1', 'ch3');
  assert.equal(result, null);
});

test('tickets are isolated per guild+channel', async () => {
  store.clear();
  await setTicket('g1', 'ch4', { userId: 'A' });
  await setTicket('g2', 'ch4', { userId: 'B' });
  const g1 = await getTicket('g1', 'ch4');
  const g2 = await getTicket('g2', 'ch4');
  assert.equal(g1.userId, 'A');
  assert.equal(g2.userId, 'B');
});

// ── nextSerial ────────────────────────────────────────────────────────────────

test('nextSerial starts at 0001 for a new guild', async () => {
  store.clear();
  const serial = await nextSerial('g1');
  assert.equal(serial, '0001');
});

test('nextSerial increments sequentially', async () => {
  store.clear();
  const s1 = await nextSerial('g1');
  const s2 = await nextSerial('g1');
  const s3 = await nextSerial('g1');
  assert.equal(s1, '0001');
  assert.equal(s2, '0002');
  assert.equal(s3, '0003');
});

test('nextSerial is isolated per guild', async () => {
  store.clear();
  const g1s1 = await nextSerial('g1');
  const g2s1 = await nextSerial('g2');
  const g1s2 = await nextSerial('g1');
  assert.equal(g1s1, '0001');
  assert.equal(g2s1, '0001');
  assert.equal(g1s2, '0002');
});

// ── Category helpers ──────────────────────────────────────────────────────────

test('getCategoryIdForType returns null when unset', async () => {
  store.clear();
  const result = await getCategoryIdForType('g1', 'support');
  assert.equal(result, null);
});

test('setCategoryIdForType and getCategoryIdForType round-trip', async () => {
  store.clear();
  await setCategoryIdForType('g1', 'support', 'cat-123');
  const result = await getCategoryIdForType('g1', 'support');
  assert.equal(result, 'cat-123');
});

test('category ids are isolated per type', async () => {
  store.clear();
  await setCategoryIdForType('g1', 'support', 'cat-A');
  await setCategoryIdForType('g1', 'billing', 'cat-B');
  assert.equal(await getCategoryIdForType('g1', 'support'), 'cat-A');
  assert.equal(await getCategoryIdForType('g1', 'billing'), 'cat-B');
});

// ── Temp category helpers ────────────────────────────────────────────────────

test('isTempCategory returns false for unmarked category', async () => {
  store.clear();
  const result = await isTempCategory('g1', 'cat-xyz');
  assert.equal(result, false);
});

test('markTempCategory + isTempCategory round-trip', async () => {
  store.clear();
  await markTempCategory('g1', 'cat-temp');
  const result = await isTempCategory('g1', 'cat-temp');
  assert.equal(result, true);
});

test('clearTempCategory removes the mark', async () => {
  store.clear();
  await markTempCategory('g1', 'cat-temp2');
  await clearTempCategory('g1', 'cat-temp2');
  const result = await isTempCategory('g1', 'cat-temp2');
  assert.equal(result, false);
});
