'use strict';

/**
 * giveaway-enhancements.test.js
 *
 * Tests for:
 *   - resolveColor (presets, hex, fallback)
 *   - buildEntriesEmbed (pagination, edge cases)
 *   - buildEntriesRow (disabled states, page counter)
 *   - buildActiveEmbed with color and imageUrl
 */

const test   = require('node:test');
const assert = require('node:assert/strict');

// ── Minimal discord.js stub ───────────────────────────────────────────────────
class EmbedBuilder {
  constructor() { this.data = { color: 0, title: '', description: '', fields: [], footer: null, image: null }; }
  setColor(c)       { this.data.color = c; return this; }
  setTitle(t)       { this.data.title = t; return this; }
  setDescription(d) { this.data.description = d; return this; }
  setTimestamp()    { return this; }
  setFooter(f)      { this.data.footer = f; return this; }
  setImage(u)       { this.data.image = u; return this; }
  addFields(...fs)  { this.data.fields.push(...fs.flat()); return this; }
}
class ButtonBuilder {
  constructor() { this._data = {}; }
  setCustomId(id)   { this._data.customId = id; return this; }
  setLabel(l)       { this._data.label = l; return this; }
  setStyle(s)       { this._data.style = s; return this; }
  setDisabled(d)    { this._data.disabled = d; return this; }
  get customId()    { return this._data.customId; }
  get disabled()    { return this._data.disabled; }
  get label()       { return this._data.label; }
}
class ActionRowBuilder {
  constructor() { this.components = []; }
  addComponents(...c) { this.components.push(...c.flat()); return this; }
}
const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4 };

// Stub module loader
const Module = require('module');
const _orig  = Module._load;
Module._load = function(req, parent, isMain) {
  if (req === 'discord.js') return { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle };
  if (req.endsWith('/db') || req.endsWith('\\db')) return { db: { get: async()=>null, set: async()=>{} } };
  if (req.endsWith('/logger') || req.endsWith('\\logger')) return { logger: { info:()=>{}, warn:()=>{}, error:()=>{} } };
  if (req.endsWith('/metrics') || req.endsWith('\\metrics')) return { metrics: { increment:()=>{}, gauge:()=>{} } };
  return _orig.apply(this, arguments);
};

const {
  resolveColor,
  buildEntriesEmbed,
  buildEntriesRow,
  buildActiveEmbed,
} = require('../src/services/giveawayHelpers');

// ── resolveColor ──────────────────────────────────────────────────────────────

test('resolveColor: gold preset', () => assert.equal(resolveColor('gold'), 0xF1C40F));
test('resolveColor: red preset',  () => assert.equal(resolveColor('red'),  0xE74C3C));
test('resolveColor: blue preset', () => assert.equal(resolveColor('blue'), 0x3498DB));
test('resolveColor: green preset',() => assert.equal(resolveColor('green'),0x2ECC71));
test('resolveColor: purple preset',()=> assert.equal(resolveColor('purple'),0x9B59B6));
test('resolveColor: pink preset', () => assert.equal(resolveColor('pink'), 0xFF69B4));
test('resolveColor: cyan preset', () => assert.equal(resolveColor('cyan'), 0x1ABC9C));
test('resolveColor: white preset',() => assert.equal(resolveColor('white'),0xFFFFFF));

test('resolveColor: hex string without #', () => {
  assert.equal(resolveColor('FF5733'), 0xFF5733);
});

test('resolveColor: hex string with #', () => {
  assert.equal(resolveColor('#FF5733'), 0xFF5733);
});

test('resolveColor: null returns default', () => {
  assert.equal(resolveColor(null, 0xABCDEF), 0xABCDEF);
});

test('resolveColor: none returns default', () => {
  assert.equal(resolveColor('none', 0x123456), 0x123456);
});

test('resolveColor: invalid string returns default', () => {
  assert.equal(resolveColor('notacolor', 0x999999), 0x999999);
});

test('resolveColor: undefined returns default', () => {
  assert.equal(resolveColor(undefined, 0x111111), 0x111111);
});

// ── buildActiveEmbed with color + imageUrl ────────────────────────────────────

test('buildActiveEmbed uses custom color', () => {
  const g = { id: '1', prize: 'Test', entries: [], winnerCount: 1, endTime: Date.now() + 60000, hostId: 'h1', color: 'blue', imageUrl: null };
  const embed = buildActiveEmbed(g);
  assert.equal(embed.data.color, 0x3498DB);
});

test('buildActiveEmbed sets image when imageUrl provided', () => {
  const g = { id: '1', prize: 'Test', entries: [], winnerCount: 1, endTime: Date.now() + 60000, hostId: 'h1', color: null, imageUrl: 'https://example.com/img.png' };
  const embed = buildActiveEmbed(g);
  assert.equal(embed.data.image, 'https://example.com/img.png');
});

test('buildActiveEmbed does not set image when imageUrl is null', () => {
  const g = { id: '1', prize: 'Test', entries: [], winnerCount: 1, endTime: Date.now() + 60000, hostId: 'h1', color: null, imageUrl: null };
  const embed = buildActiveEmbed(g);
  assert.equal(embed.data.image, null);
});

test('buildActiveEmbed uses default gold when no color', () => {
  const g = { id: '1', prize: 'Test', entries: [], winnerCount: 1, endTime: Date.now() + 60000, hostId: 'h1' };
  const embed = buildActiveEmbed(g);
  assert.equal(embed.data.color, 0xF1C40F);
});

// ── buildEntriesEmbed ─────────────────────────────────────────────────────────

function makeGiveaway(entryCount, extra = {}) {
  return {
    id: 'gtest123',
    prize: 'Test Prize',
    entries: Array.from({ length: entryCount }, (_, i) => `user${i}`),
    winnerCount: 1,
    endTime: Date.now() + 60000,
    hostId: 'host1',
    ended: false,
    color: null,
    ...extra,
  };
}

test('buildEntriesEmbed page 0 shows first 10 users', () => {
  const g     = makeGiveaway(25);
  const embed = buildEntriesEmbed(g, 0);
  // 10 lines expected
  const lines = embed.data.description.split('\n').filter(Boolean);
  assert.equal(lines.length, 10);
  assert.ok(lines[0].includes('user0'), 'First line should be user0');
  assert.ok(lines[9].includes('user9'), 'Last line of page 0 should be user9');
});

test('buildEntriesEmbed page 1 shows users 10-19', () => {
  const g     = makeGiveaway(25);
  const embed = buildEntriesEmbed(g, 1);
  const lines = embed.data.description.split('\n').filter(Boolean);
  assert.equal(lines.length, 10);
  assert.ok(lines[0].includes('user10'));
});

test('buildEntriesEmbed last page shows remaining users', () => {
  const g     = makeGiveaway(25); // 3 pages: 10, 10, 5
  const embed = buildEntriesEmbed(g, 2);
  const lines = embed.data.description.split('\n').filter(Boolean);
  assert.equal(lines.length, 5);
});

test('buildEntriesEmbed footer shows correct page count', () => {
  const g     = makeGiveaway(25);
  const embed = buildEntriesEmbed(g, 0);
  assert.ok(embed.data.footer.text.includes('Page 1/3'), `Expected Page 1/3, got: ${embed.data.footer.text}`);
});

test('buildEntriesEmbed clamps out-of-range page to last page', () => {
  const g     = makeGiveaway(10); // 1 page
  const embed = buildEntriesEmbed(g, 99);
  const lines = embed.data.description.split('\n').filter(Boolean);
  assert.equal(lines.length, 10);
  assert.ok(embed.data.footer.text.includes('Page 1/1'));
});

test('buildEntriesEmbed single entry single page', () => {
  const g     = makeGiveaway(1);
  const embed = buildEntriesEmbed(g, 0);
  assert.ok(embed.data.footer.text.includes('Page 1/1'));
  const lines = embed.data.description.split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
});

test('buildEntriesEmbed shows total entries in fields', () => {
  const g     = makeGiveaway(15);
  const embed = buildEntriesEmbed(g, 0);
  const totalField = embed.data.fields.find(f => f.name === 'Total Entries');
  assert.ok(totalField, 'Should have Total Entries field');
  assert.equal(totalField.value, '15');
});

// ── buildEntriesRow ───────────────────────────────────────────────────────────

test('buildEntriesRow page 0: Previous button disabled, Next enabled', () => {
  const row  = buildEntriesRow('g1', 0, 25); // 3 pages
  const [prev, , next] = row.components;
  assert.equal(prev.disabled, true,  'Previous should be disabled on page 0');
  assert.equal(next.disabled, false, 'Next should be enabled on page 0');
});

test('buildEntriesRow last page: Previous enabled, Next disabled', () => {
  const row  = buildEntriesRow('g1', 2, 25); // page 2 of 3 (0-indexed last)
  const [prev, , next] = row.components;
  assert.equal(prev.disabled, false, 'Previous should be enabled on last page');
  assert.equal(next.disabled, true,  'Next should be disabled on last page');
});

test('buildEntriesRow single page: both navigation buttons disabled', () => {
  const row  = buildEntriesRow('g1', 0, 5); // 1 page of 5 entries
  const [prev, , next] = row.components;
  assert.equal(prev.disabled, true,  'Previous disabled on single page');
  assert.equal(next.disabled, true,  'Next disabled on single page');
});

test('buildEntriesRow counter button shows correct page label', () => {
  const row     = buildEntriesRow('g1', 1, 25); // page 2 of 3
  const counter = row.components[1];
  assert.ok(counter.label.includes('2'), `Expected page 2 in label, got: ${counter.label}`);
  assert.ok(counter.label.includes('3'), `Expected 3 total pages in label, got: ${counter.label}`);
  assert.equal(counter.disabled, true, 'Counter button should always be disabled');
});

test('buildEntriesRow Next button customId encodes correct next page', () => {
  const row  = buildEntriesRow('gtest123', 0, 25);
  const next = row.components[2];
  assert.ok(next.customId.includes('gtest123'), 'customId should include giveaway ID');
  assert.ok(next.customId.endsWith(':1'), 'Next on page 0 should point to page 1');
});

test('buildEntriesRow Previous button customId encodes correct prev page', () => {
  const row  = buildEntriesRow('gtest123', 2, 25);
  const prev = row.components[0];
  assert.ok(prev.customId.endsWith(':1'), 'Previous on page 2 should point to page 1');
});
