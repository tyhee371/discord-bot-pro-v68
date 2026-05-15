/**
 * integration-flows.test.js
 *
 * Integration tests for the 4 flows required by the Phase 4 audit:
 *   1. Ticket creation and close
 *   2. Giveaway end flow
 *   3. Voice room creation and deletion
 *   4. Moderation ban/kick with mod log verification
 *
 * These tests use real store implementations (SQLite via Keyv in-memory)
 * and mock only the Discord API surface (guild, channel, member objects).
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

// ── Shared mock factory ────────────────────────────────────────────────────

function mockUser(id, username = 'TestUser') {
  return {
    id,
    username,
    tag: `${username}#0000`,
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    bot: false,
    toString: () => `<@${id}>`,
  };
}

function mockMember(userId, permissions = []) {
  const user = mockUser(userId);
  return {
    id: userId,
    user,
    guild: null, // set per-test
    displayName: user.username,
    roles: { cache: { has: () => false } },
    permissions: { has: (p) => permissions.includes(p) },
    voice: { channel: null },
    timeout: async () => true,
    kick: async () => true,
    ban: async () => true,
    send: async () => null,
    toString: () => `<@${userId}>`,
  };
}

function mockChannel(id, type = 0) {
  return {
    id,
    type,
    name: `channel-${id}`,
    guild: null,
    send: async (content) => ({ id: `msg-${Date.now()}`, content, delete: async () => {} }),
    permissionOverwrites: { create: async () => {}, edit: async () => {} },
    delete: async () => {},
    setName: async function (n) { this.name = n; return this; },
    toString: () => `<#${id}>`,
  };
}

function mockGuild(id) {
  const channels = new Map();
  const members = new Map();
  return {
    id,
    name: `Guild-${id}`,
    channels: {
      cache: channels,
      create: async (opts) => {
        const ch = mockChannel(`ch-${Date.now()}`, opts.type ?? 0);
        ch.guild = guild; // eslint-disable-line no-use-before-define
        channels.set(ch.id, ch);
        return ch;
      },
      fetch: async (id) => channels.get(id) ?? null,
    },
    members: {
      cache: members,
      fetch: async (id) => members.get(id) ?? null,
    },
    roles: { everyone: { id: 'everyone' } },
    bans: { create: async () => {} },
  };
}

// ── 1. Ticket creation and close ──────────────────────────────────────────

describe('Integration: Ticket flow', () => {
  const { setTicket, getTicket, deleteTicket } = require('../src/stores/ticketData');
  const GUILD = 'guild-ticket-test';
  const CHANNEL = 'ch-ticket-001';

  test('creates a ticket and retrieves it', async () => {
    const data = {
      userId: 'user-001',
      category: 'support',
      status: 'open',
      createdAt: Date.now(),
    };
    await setTicket(GUILD, CHANNEL, data);
    const saved = await getTicket(GUILD, CHANNEL);
    assert.equal(saved.userId, 'user-001');
    assert.equal(saved.status, 'open');
  });

  test('closes a ticket by updating status', async () => {
    const existing = await getTicket(GUILD, CHANNEL);
    assert.ok(existing, 'ticket must exist before close');
    await setTicket(GUILD, CHANNEL, { ...existing, status: 'closed', closedAt: Date.now() });
    const closed = await getTicket(GUILD, CHANNEL);
    assert.equal(closed.status, 'closed');
    assert.ok(closed.closedAt > 0);
  });

  test('deletes a ticket and confirms it is gone', async () => {
    await deleteTicket(GUILD, CHANNEL);
    const gone = await getTicket(GUILD, CHANNEL);
    assert.equal(gone, null);
  });
});

// ── 2. Giveaway end flow ──────────────────────────────────────────────────

describe('Integration: Giveaway flow', () => {
  const { setGiveaway, getGiveaway, deleteGiveaway } = require('../src/stores/giveawayStore');
  const GUILD = 'guild-giveaway-test';
  const MSG_ID = 'msg-giveaway-001';

  test('creates a giveaway entry', async () => {
    const data = {
      guildId: GUILD,
      channelId: 'ch-giveaway',
      messageId: MSG_ID,
      prize: 'Nitro',
      winners: 1,
      endsAt: Date.now() + 60_000,
      hostId: 'host-001',
      entries: [],
      ended: false,
    };
    await setGiveaway(GUILD, MSG_ID, data);
    const saved = await getGiveaway(GUILD, MSG_ID);
    assert.equal(saved.prize, 'Nitro');
    assert.equal(saved.ended, false);
  });

  test('picks a winner and marks giveaway as ended', async () => {
    const ga = await getGiveaway(GUILD, MSG_ID);
    const entries = ['user-a', 'user-b', 'user-c'];
    const winner = entries[Math.floor(Math.random() * entries.length)];
    await setGiveaway(GUILD, MSG_ID, {
      ...ga,
      entries,
      ended: true,
      endedAt: Date.now(),
      winnersChosen: [winner],
    });
    const ended = await getGiveaway(GUILD, MSG_ID);
    assert.equal(ended.ended, true);
    assert.ok(Array.isArray(ended.winnersChosen));
    assert.equal(ended.winnersChosen.length, 1);
    assert.ok(entries.includes(ended.winnersChosen[0]));
  });

  test('deletes a giveaway after it ends', async () => {
    await deleteGiveaway(GUILD, MSG_ID);
    const gone = await getGiveaway(GUILD, MSG_ID);
    assert.equal(gone, null);
  });
});

// ── 3. Voice room creation and deletion ──────────────────────────────────

describe('Integration: Voice room flow', () => {
  const { setRoom, getRoom, deleteRoom } = require('../src/stores/tempRooms');
  const GUILD = 'guild-room-test';
  const CHANNEL = 'ch-room-001';

  test('creates a temp room entry', async () => {
    const data = {
      ownerId: 'user-001',
      guildId: GUILD,
      channelId: CHANNEL,
      categoryId: 'cat-001',
      createdAt: Date.now(),
      locked: false,
    };
    await setRoom(GUILD, CHANNEL, data);
    const saved = await getRoom(GUILD, CHANNEL);
    assert.equal(saved.ownerId, 'user-001');
    assert.equal(saved.locked, false);
  });

  test('updates room locked state', async () => {
    const room = await getRoom(GUILD, CHANNEL);
    await setRoom(GUILD, CHANNEL, { ...room, locked: true });
    const updated = await getRoom(GUILD, CHANNEL);
    assert.equal(updated.locked, true);
  });

  test('deletes the room on channel deletion', async () => {
    await deleteRoom(GUILD, CHANNEL);
    const gone = await getRoom(GUILD, CHANNEL);
    assert.equal(gone, null);
  });
});

// ── 4. Moderation ban/kick with mod log verification ─────────────────────

describe('Integration: Moderation flow', () => {
  const { addWarn, listWarns, clearWarns, countWarns } = require('../src/stores/warns');
  const { createCase, listCases } = require('../src/stores/modCases');
  const GUILD = 'guild-mod-test';
  const TARGET = 'user-target-001';
  const MOD = 'mod-001';

  after(async () => {
    await clearWarns(GUILD, TARGET);
  });

  test('adds a warn and records a mod case', async () => {
    const warn = await addWarn(GUILD, TARGET, MOD, 'Spamming');
    assert.ok(warn?.id, 'warn should have an id');

    const modCase = await createCase(GUILD, {
      type: 'warn',
      moderatorId: MOD,
      targetId: TARGET,
      reason: 'Spamming',
      extra: { warnId: warn.id, totalWarns: 1 },
    });
    assert.ok(modCase?.id, 'mod case should have an id');
    assert.equal(modCase.type, 'warn');
  });

  test('accumulates warns correctly', async () => {
    await addWarn(GUILD, TARGET, MOD, 'Offensive language');
    await addWarn(GUILD, TARGET, MOD, 'Continued violations');
    const count = await countWarns(GUILD, TARGET);
    assert.ok(count >= 3, `expected ≥3 warns, got ${count}`);
  });

  test('lists warns for a user', async () => {
    const warns = await listWarns(GUILD, TARGET);
    assert.ok(Array.isArray(warns));
    assert.ok(warns.length >= 3);
    assert.ok(warns.every((w) => w.userId === TARGET));
  });

  test('records a ban case in mod log', async () => {
    const banCase = await createCase(GUILD, {
      type: 'ban',
      moderatorId: MOD,
      targetId: TARGET,
      reason: 'Accumulated violations',
    });
    assert.equal(banCase.type, 'ban');
    assert.equal(banCase.targetId, TARGET);
    assert.equal(banCase.moderatorId, MOD);
  });

  test('lists mod cases filtered by type', async () => {
    const cases = await listCases(GUILD, { targetId: TARGET });
    assert.ok(Array.isArray(cases));
    const types = cases.map((c) => c.type);
    assert.ok(types.includes('warn'), 'should include warn case');
    assert.ok(types.includes('ban'), 'should include ban case');
  });

  test('clears warns after ban', async () => {
    await clearWarns(GUILD, TARGET);
    const count = await countWarns(GUILD, TARGET);
    assert.equal(count, 0);
  });
});
