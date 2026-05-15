/**
 * Regression tests — Phase 3 new systems
 * Covers: configValidator (pure logic), modStats helpers, ticketSla
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// ─────────────────────────────────────────────────────────────────────────────
// ticketSla — pure utility, no Discord needed
// ─────────────────────────────────────────────────────────────────────────────

// Stub discord.js for the EmbedBuilder in ticketSla
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'discord.js') {
    return {
      EmbedBuilder: class {
        setTitle() { return this; }
        setDescription() { return this; }
        setTimestamp() { return this; }
        setColor() { return this; }
        setFooter() { return this; }
        addFields(fields) { this._fields = fields; return this; }
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

const {
  stampOpened,
  stampClaimed,
  stampClosed,
  getSlaMetrics,
  buildCloseReceiptEmbed,
  fmtDuration,
} = require('../src/utils/ticketSla');

// ── stampOpened ───────────────────────────────────────────────────────────────

test('ticketSla: stampOpened sets sla.openedAt', () => {
  const before = Date.now();
  const ticket = stampOpened({});
  assert.ok(ticket.sla?.openedAt >= before);
  assert.ok(ticket.sla.openedAt <= Date.now());
});

test('ticketSla: stampOpened does not overwrite existing openedAt', () => {
  const original = { sla: { openedAt: 12345 } };
  const ticket = stampOpened(original);
  assert.equal(ticket.sla.openedAt, 12345);
});

// ── stampClaimed ──────────────────────────────────────────────────────────────

test('ticketSla: stampClaimed sets sla.claimedAt and claimedBy', () => {
  const before = Date.now();
  const ticket = stampClaimed({ sla: { openedAt: before - 5000 } }, 'user-123');
  assert.ok(ticket.sla.claimedAt >= before);
  assert.equal(ticket.sla.claimedBy, 'user-123');
  assert.equal(ticket.claimedBy, 'user-123');
});

test('ticketSla: stampClaimed does not overwrite existing claimedAt', () => {
  const ticket = stampClaimed({ sla: { claimedAt: 99999, claimedBy: 'original' } }, 'new-user');
  assert.equal(ticket.sla.claimedAt, 99999);
  assert.equal(ticket.sla.claimedBy, 'original');
});

// ── stampClosed ───────────────────────────────────────────────────────────────

test('ticketSla: stampClosed sets sla.closedAt and closedBy', () => {
  const before = Date.now();
  const ticket = stampClosed({}, 'mod-456');
  assert.ok(ticket.sla.closedAt >= before);
  assert.equal(ticket.sla.closedBy, 'mod-456');
});

test('ticketSla: stampClosed does not overwrite existing closedAt', () => {
  const ticket = stampClosed({ sla: { closedAt: 77777 } }, 'mod-2');
  assert.equal(ticket.sla.closedAt, 77777);
});

// ── getSlaMetrics ─────────────────────────────────────────────────────────────

test('ticketSla: getSlaMetrics computes all three durations', () => {
  const openedAt = 1_000_000;
  const claimedAt = 1_060_000;  // 60s after open
  const closedAt  = 1_180_000;  // 120s after open, 120s after claim

  const ticket = { sla: { openedAt, claimedAt, closedAt, claimedBy: 'u1', closedBy: 'u2' } };
  const m = getSlaMetrics(ticket);

  assert.equal(m.timeToClaimMs, 60_000);
  assert.equal(m.timeToCloseMs, 180_000);
  assert.equal(m.handleTimeMs,  120_000);
  assert.equal(m.claimedBy, 'u1');
  assert.equal(m.closedBy, 'u2');
});

test('ticketSla: getSlaMetrics returns null for missing timestamps', () => {
  const m = getSlaMetrics({ sla: { openedAt: 1_000_000 } });
  assert.equal(m.timeToClaimMs, null);
  assert.equal(m.timeToCloseMs, null);
  assert.equal(m.handleTimeMs, null);
});

test('ticketSla: getSlaMetrics falls back to ticket.createdAt for openedAt', () => {
  const ticket = { createdAt: 5_000_000, sla: {} };
  const m = getSlaMetrics(ticket);
  assert.equal(m.openedAt, 5_000_000);
});

// ── fmtDuration ───────────────────────────────────────────────────────────────

test('ticketSla: fmtDuration formats seconds', () => {
  assert.equal(fmtDuration(45_000), '45s');
});

test('ticketSla: fmtDuration formats minutes and seconds', () => {
  assert.equal(fmtDuration(125_000), '2m 5s');
});

test('ticketSla: fmtDuration formats hours', () => {
  assert.equal(fmtDuration(3_720_000), '1h 2m');
});

test('ticketSla: fmtDuration returns — for null/zero', () => {
  assert.equal(fmtDuration(null), '—');
  assert.equal(fmtDuration(0), '—');
});

// ─────────────────────────────────────────────────────────────────────────────
// configValidator — pure function tests (no live Discord guild needed)
// ─────────────────────────────────────────────────────────────────────────────

const { formatValidationResults } = require('../src/utils/configValidator');

const SAMPLE_RESULTS = [
  { level: 'error', area: 'Mod Logs', message: 'Channel not found.', fix: 'Run /modlogs setup.' },
  { level: 'warn',  area: 'Tickets',  message: 'No panels configured.', fix: 'Create a panel.' },
  { level: 'ok',    area: 'Starboard', message: 'Channel reachable.', fix: null },
];

test('configValidator: formatValidationResults produces one field per result', () => {
  const { fields } = formatValidationResults(SAMPLE_RESULTS);
  assert.equal(fields.length, 3);
});

test('configValidator: summary shows error count when errors present', () => {
  const { summary } = formatValidationResults(SAMPLE_RESULTS);
  assert.ok(summary.includes('1 error'));
});

test('configValidator: summary shows only warnings when no errors', () => {
  const noErrors = SAMPLE_RESULTS.filter((r) => r.level !== 'error');
  const { summary } = formatValidationResults(noErrors);
  assert.ok(!summary.includes('error'));
  assert.ok(summary.includes('warning') || summary.includes('warn'));
});

test('configValidator: summary shows all-ok when no errors or warnings', () => {
  const allOk = [{ level: 'ok', area: 'A', message: 'Fine.', fix: null }];
  const { summary } = formatValidationResults(allOk);
  assert.ok(summary.toLowerCase().includes('passed') || summary.includes('✅'));
});

test('configValidator: fields include fix hint when fix is provided', () => {
  const { fields } = formatValidationResults(SAMPLE_RESULTS);
  const errorField = fields.find((f) => f.name.includes('Mod Logs'));
  assert.ok(errorField?.value?.includes('Run /modlogs setup.'));
});

test('configValidator: fields show no-action message when fix is null', () => {
  const { fields } = formatValidationResults(SAMPLE_RESULTS);
  const okField = fields.find((f) => f.name.includes('Starboard'));
  assert.ok(okField?.value?.includes('No action needed'));
});

// ─────────────────────────────────────────────────────────────────────────────
// modStats — pure aggregation logic
// ─────────────────────────────────────────────────────────────────────────────

test('modStats: getUserModStats returns zero stats for empty case list', async () => {
  // Stub db + modCases
  const store = new Map();
  const db = {
    async get(key) { return store.get(key) ?? null; },
    async set(key, v) { store.set(key, v); },
    async delete(key) { store.delete(key); },
  };
  Module._load = function (req, parent, isMain) {
    if (req === 'discord.js') return { EmbedBuilder: class { setTitle() { return this; } setDescription() { return this; } setTimestamp() { return this; } setColor() { return this; } setFooter() { return this; } addFields() { return this; } } };
    if (req.endsWith('/db') || req.endsWith('\\db')) return { db };
    return originalLoad.apply(this, arguments);
  };

  // Clear cache
  delete require.cache[require.resolve('../src/utils/modCases')];
  delete require.cache[require.resolve('../src/utils/modStats')];

  const { getUserModStats } = require('../src/utils/modStats');
  const stats = await getUserModStats('g1', 'nobody');
  assert.equal(stats.totalCases, 0);
  assert.equal(stats.appealCount, 0);
  assert.equal(stats.latestCase, null);
});
