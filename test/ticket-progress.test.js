/**
 * ticket-progress.test.js
 *
 * Tests for:
 *   - ticketProgressService (buildProgressEmbed, getStatusMeta)
 *   - settings default includes progressChannelId
 *   - settings deepMerge preserves progressChannelId through migration
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

// ── Minimal discord.js stub (only what ticketProgressService needs) ───────────
class EmbedBuilder {
  constructor() {
    this.data = { description: '', color: 0, fields: [], footer: null };
  }
  setColor(c)       { this.data.color = c; return this; }
  setDescription(d) { this.data.description = d; return this; }
  setTimestamp()    { return this; }
  setFooter(f)      { this.data.footer = f; return this; }
  addFields(fs)     { this.data.fields.push(...(Array.isArray(fs) ? fs : [fs])); return this; }
}

class AttachmentBuilder {
  constructor(buf, opts) { this.buf = buf; this.opts = opts; }
}

// ── Stub db so settings.js doesn't require a real SQLite file ─────────────────
const store = new Map();
const dbStub = {
  async get(key)        { return store.get(key) ?? null; },
  async set(key, value) { store.set(key, value); },
  async delete(key)     { store.delete(key); },
};

const Module = require('module');
const _origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('/db') || request.endsWith('\\db')) return { db: dbStub };
  if (request === 'discord.js') return { EmbedBuilder, AttachmentBuilder };
  if (request.endsWith('/logger') || request.endsWith('\\logger'))
    return { logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } };
  if (request.endsWith('/metrics') || request.endsWith('\\metrics'))
    return { metrics: { increment: () => {}, gauge: () => {}, rate: () => {} } };
  if (request.endsWith('/logService') || request.endsWith('\\logService'))
    return { resolveLogChannel: async () => null };
  if (request.endsWith('/redis') || request.endsWith('\\redis'))
    return { redisClient: { isAvailable: () => false, get: async () => null, set: async () => true } };
  return _origLoad.apply(this, arguments);
};

// ── Load modules under test (after stub is in place) ─────────────────────────
const { buildProgressEmbed, getStatusMeta } = require('../src/services/ticketProgressService');
const { getGuildSettings, setGuildSettings, migrateSettings } = require('../src/stores/settings');

// ─────────────────────────────────────────────────────────────────────────────
// getStatusMeta
// ─────────────────────────────────────────────────────────────────────────────

test('getStatusMeta returns amber color for open status', () => {
  const meta = getStatusMeta('open');
  assert.equal(meta.color, 0xf59e0b);
  assert.ok(meta.label.includes('ĐANG'));
});

test('getStatusMeta returns blue color for claimed status', () => {
  const meta = getStatusMeta('claimed');
  assert.equal(meta.color, 0x3b82f6);
});

test('getStatusMeta returns green color for closed status', () => {
  const meta = getStatusMeta('closed');
  assert.equal(meta.color, 0x22c55e);
});

test('getStatusMeta returns red color for cancelled status', () => {
  const meta = getStatusMeta('cancelled');
  assert.equal(meta.color, 0xef4444);
  assert.ok(meta.label.includes('HUỶ'), 'cancelled label should contain HUỶ');
});

test('buildProgressEmbed shows cancelled label for cancelled status', () => {
  const ticket = { openerId: 'u1', typeLabel: 'Support', createdAt: Date.now() };
  const embed  = buildProgressEmbed({ ticket, channel: null, status: 'cancelled', guildName: 'G' });
  assert.ok((embed.data.description ?? '').includes('HUỶ'), 'should show ĐƠN BỊ HUỶ');
  assert.equal(embed.data.color, 0xef4444, 'should be red');
});

test('getStatusMeta falls back to open meta for unknown status', () => {
  const meta = getStatusMeta('bogus');
  assert.equal(meta.color, getStatusMeta('open').color);
});

// ─────────────────────────────────────────────────────────────────────────────
// buildProgressEmbed
// ─────────────────────────────────────────────────────────────────────────────

test('buildProgressEmbed includes opener mention in description', () => {
  const ticket = { openerId: 'u123', typeLabel: 'Support', createdAt: Date.now() };
  const embed  = buildProgressEmbed({ ticket, channel: null, status: 'open', guildName: 'Test Guild' });
  const desc   = embed.data.description ?? '';
  assert.ok(desc.includes('<@u123>'), 'Expected opener mention');
});

test('buildProgressEmbed includes type label in description', () => {
  const ticket = { openerId: 'u1', typeLabel: 'Billing', createdAt: Date.now() };
  const embed  = buildProgressEmbed({ ticket, channel: null, status: 'open', guildName: 'G' });
  assert.ok((embed.data.description ?? '').includes('Billing'), 'Expected type label');
});

test('buildProgressEmbed reflects status label', () => {
  const ticket = { openerId: 'u1', typeLabel: 'Tech', createdAt: Date.now() };

  const openEmbed    = buildProgressEmbed({ ticket, channel: null, status: 'open',    guildName: 'G' });
  const claimedEmbed = buildProgressEmbed({ ticket, channel: null, status: 'claimed', guildName: 'G' });
  const closedEmbed  = buildProgressEmbed({ ticket, channel: null, status: 'closed',  guildName: 'G' });

  assert.ok((openEmbed.data.description ?? '').includes('ĐANG'), 'open → ĐANG THỰC HIỆN');
  assert.ok((claimedEmbed.data.description ?? '').includes('ĐANG'), 'claimed → ĐANG THỰC HIỆN');
  assert.ok((closedEmbed.data.description ?? '').includes('HOÀN'), 'closed → ĐÃ HOÀN THÀNH');
});

test('buildProgressEmbed includes claimedBy mention when provided', () => {
  const ticket = { openerId: 'u1', typeLabel: 'Bug', createdAt: Date.now() };
  const embed  = buildProgressEmbed({ ticket, channel: null, status: 'claimed', claimedBy: 'staff1', guildName: 'G' });
  assert.ok((embed.data.description ?? '').includes('<@staff1>'), 'Expected claimer mention');
});

test('buildProgressEmbed shows closedAt timestamp for closed status', () => {
  const now    = Date.now();
  const ticket = { openerId: 'u1', typeLabel: 'Bug', createdAt: now, sla: { closedAt: now } };
  const embed  = buildProgressEmbed({ ticket, channel: null, status: 'closed', guildName: 'G' });
  // Should have two timestamps (opened + closed)
  const desc   = embed.data.description ?? '';
  const tMatches = (desc.match(/<t:\d+:R>/g) || []).length;
  assert.ok(tMatches >= 2, `Expected ≥2 timestamps, got ${tMatches}`);
});

test('buildProgressEmbed sets correct color per status', () => {
  const ticket = { openerId: 'u1', typeLabel: 'X', createdAt: Date.now() };

  assert.equal(
    buildProgressEmbed({ ticket, channel: null, status: 'open',    guildName: 'G' }).data.color,
    0xf59e0b,
  );
  assert.equal(
    buildProgressEmbed({ ticket, channel: null, status: 'claimed', guildName: 'G' }).data.color,
    0x3b82f6,
  );
  assert.equal(
    buildProgressEmbed({ ticket, channel: null, status: 'closed',  guildName: 'G' }).data.color,
    0x22c55e,
  );
});

test('buildProgressEmbed handles missing openerId gracefully', () => {
  const ticket = { typeLabel: 'Support', createdAt: Date.now() };
  // Should not throw
  assert.doesNotThrow(() => buildProgressEmbed({ ticket, channel: null, status: 'open', guildName: 'G' }));
});

test('buildProgressEmbed uses typeValue when typeLabel is absent', () => {
  const ticket = { openerId: 'u1', typeValue: 'billing_inquiry', createdAt: Date.now() };
  const embed  = buildProgressEmbed({ ticket, channel: null, status: 'open', guildName: 'G' });
  assert.ok((embed.data.description ?? '').includes('billing_inquiry'));
});

// ─────────────────────────────────────────────────────────────────────────────
// Settings: progressChannelId default and migration
// ─────────────────────────────────────────────────────────────────────────────

test('fresh settings include progressChannelId null in tickets', async () => {
  store.clear();
  const settings = await getGuildSettings('guild-progress-test-1');
  assert.ok('progressChannelId' in (settings.tickets ?? {}), 'progressChannelId key should exist');
  assert.equal(settings.tickets.progressChannelId, null);
});

test('setGuildSettings persists progressChannelId', async () => {
  store.clear();
  await setGuildSettings('guild-progress-test-2', {
    tickets: { progressChannelId: 'ch-123' },
  });
  const settings = await getGuildSettings('guild-progress-test-2');
  assert.equal(settings.tickets.progressChannelId, 'ch-123');
});

test('setGuildSettings progressChannelId does not overwrite other ticket fields', async () => {
  store.clear();
  // First configure the ticket system
  await setGuildSettings('guild-progress-test-3', {
    tickets: {
      adminRoleId: 'role-admin',
      modRoleId: 'role-mod',
      transcriptChannelId: 'ch-transcript',
    },
  });
  // Then set progress channel separately
  await setGuildSettings('guild-progress-test-3', {
    tickets: { progressChannelId: 'ch-progress' },
  });
  const settings = await getGuildSettings('guild-progress-test-3');
  assert.equal(settings.tickets.adminRoleId, 'role-admin', 'adminRoleId should be preserved');
  assert.equal(settings.tickets.transcriptChannelId, 'ch-transcript', 'transcriptChannelId should be preserved');
  assert.equal(settings.tickets.progressChannelId, 'ch-progress', 'progressChannelId should be set');
});

test('progressChannelId can be cleared back to null', async () => {
  store.clear();
  await setGuildSettings('guild-progress-test-4', { tickets: { progressChannelId: 'ch-x' } });
  await setGuildSettings('guild-progress-test-4', { tickets: { progressChannelId: null } });
  const settings = await getGuildSettings('guild-progress-test-4');
  assert.equal(settings.tickets.progressChannelId, null);
});

test('migrateSettings adds progressChannelId to legacy settings without it', () => {
  const legacy = {
    schemaVersion: 5,
    tickets: {
      adminRoleId: 'r1',
      modRoleId:   'r2',
      builders:    {},
    },
  };
  const { settings } = migrateSettings(legacy);
  assert.ok('progressChannelId' in (settings.tickets ?? {}), 'Migration should add progressChannelId key');
  assert.equal(settings.tickets.progressChannelId, null);
});

test('migrateSettings does not overwrite existing progressChannelId', () => {
  const existing = {
    schemaVersion: 5,
    tickets: {
      adminRoleId: 'r1',
      progressChannelId: 'ch-already-set',
      builders: {},
    },
  };
  const { settings } = migrateSettings(existing);
  assert.equal(settings.tickets.progressChannelId, 'ch-already-set');
});

// ─────────────────────────────────────────────────────────────────────────────
// Channel isolation
// ─────────────────────────────────────────────────────────────────────────────

test('progressChannelId is isolated per guild', async () => {
  store.clear();
  await setGuildSettings('g-iso-1', { tickets: { progressChannelId: 'ch-g1' } });
  await setGuildSettings('g-iso-2', { tickets: { progressChannelId: 'ch-g2' } });

  const s1 = await getGuildSettings('g-iso-1');
  const s2 = await getGuildSettings('g-iso-2');

  assert.equal(s1.tickets.progressChannelId, 'ch-g1');
  assert.equal(s2.tickets.progressChannelId, 'ch-g2');
});
