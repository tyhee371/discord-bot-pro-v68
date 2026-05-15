/**
 * storageManifest.js — single source of truth for all Keyv storage namespaces.
 *
 * Documents every key prefix used in the database, the owning module,
 * the value schema version, and a human description. Used by:
 *   - /doctor storage diagnostics
 *   - future migration tooling
 *   - dead-key cleanup utilities
 *
 * Key naming convention:  <namespace>:<discriminator>
 * e.g.  settings:1234567890     → guild settings for guild 1234567890
 *       warns:guildId:userId    → warn list for a user in a guild
 *       scheduler:job:jobId     → durable scheduler job record
 *
 * Adding a new key space:
 *   1. Add an entry to STORAGE_MANIFEST below.
 *   2. If the value has schema versioning, set schemaVersion.
 *   3. If old keys need cleanup, add a migration fn.
 */

const STORAGE_MANIFEST = [
  // ── Core ───────────────────────────────────────────────────────────────────
  {
    prefix:        'settings:',
    owner:         'src/stores/settings.js',
    description:   'Per-guild bot configuration (prefix, modules, channels, roles)',
    schemaVersion: 4,
    critical:      true,
  },

  // ── Moderation ────────────────────────────────────────────────────────────
  {
    prefix:        'warns:',
    owner:         'src/stores/warns.js',
    description:   'Per-user warn list — warns:<guildId>:<userId>',
    schemaVersion: 1,
    critical:      false,
  },
  {
    prefix:        'modcase:',
    owner:         'src/utils/modCases.js',
    description:   'Individual mod case records — modcase:<guildId>:<caseId>',
    schemaVersion: 1,
    critical:      false,
  },
  {
    prefix:        'modcaseSerial:',
    owner:         'src/utils/modCases.js',
    description:   'Atomic case ID counter — modcaseSerial:<guildId>',
    schemaVersion: 1,
    critical:      false,
  },
  {
    prefix:        'modcaseIdx:',
    owner:         'src/utils/modCases.js',
    description:   'Per-user case index — modcaseIdx:<guildId>:<userId>',
    schemaVersion: 1,
    critical:      false,
  },
  {
    prefix:        'modcaseAllIndex:',
    owner:         'src/utils/modStats.js',
    description:   'All-cases index for analytics — modcaseAllIndex:<guildId>',
    schemaVersion: 1,
    critical:      false,
  },
  {
    prefix:        'prisonTimers:',
    owner:         'src/utils/prisonService.js',
    description:   'Prison (timeout jail) release timers — prisonTimers:<guildId>',
    schemaVersion: 1,
    critical:      false,
  },

  // ── Tickets ───────────────────────────────────────────────────────────────
  {
    prefix:        'ticket:',
    owner:         'src/services/ticketService.js',
    description:   'Ticket channel records — ticket:<guildId>:<channelId>',
    schemaVersion: 2,
    critical:      false,
  },
  {
    prefix:        'ticketSerial:',
    owner:         'src/utils/ticketV2Store.js',
    description:   'Atomic ticket serial counter — ticketSerial:<guildId>',
    schemaVersion: 1,
    critical:      false,
  },
  {
    prefix:        'ticketCat:',
    owner:         'src/utils/ticketV2Store.js',
    description:   'Category ID per ticket type — ticketCat:<guildId>:<typeValue>',
    schemaVersion: 1,
    critical:      false,
  },
  {
    prefix:        'ticketTempCat:',
    owner:         'src/utils/ticketV2Store.js',
    description:   'Temporary category marker — ticketTempCat:<guildId>:<categoryId>',
    schemaVersion: 1,
    critical:      false,
  },
  {
    prefix:        'openTicket:',
    owner:         'src/services/ticketService.js',
    description:   'One-open-ticket-per-user tracking — openTicket:<guildId>:<userId>',
    schemaVersion: 1,
    critical:      false,
  },

  // ── Giveaways ─────────────────────────────────────────────────────────────
  {
    prefix:        'giveaway:',
    owner:         'src/stores/giveawayStore.js',
    description:   'Individual giveaway records — giveaway:<messageId>',
    schemaVersion: 1,
    critical:      false,
  },
  {
    prefix:        'giveaway_index:',
    owner:         'src/stores/giveawayStore.js',
    description:   'Per-guild active giveaway index — giveaway_index:<guildId>',
    schemaVersion: 1,
    critical:      false,
  },

  // ── Durable Scheduler ─────────────────────────────────────────────────────
  {
    prefix:        'scheduler:job:',
    owner:         'src/app/durableScheduler.js',
    description:   'Durable job records — scheduler:job:<jobId>',
    schemaVersion: 1,
    critical:      true,
  },
  {
    prefix:        'scheduler:idx:',
    owner:         'src/app/durableScheduler.js',
    description:   'Per-guild job index — scheduler:idx:<guildId>',
    schemaVersion: 1,
    critical:      false,
  },
  {
    prefix:        'scheduler:global_idx',
    owner:         'src/app/durableScheduler.js',
    description:   'Global job index (singleton key)',
    schemaVersion: 1,
    critical:      true,
  },

  // ── Rooms ─────────────────────────────────────────────────────────────────
  {
    prefix:        'tempRoom:',
    owner:         'src/services/tempRoomService.js',
    description:   'Temp voice room records — tempRoom:<guildId>:<channelId>',
    schemaVersion: 1,
    critical:      false,
  },

  // ── Starboard ─────────────────────────────────────────────────────────────
  // Starboard posts are stored inline in settings.starboardPosts — no separate prefix.

  // ── Sticky messages ───────────────────────────────────────────────────────
  // Sticky config is stored inline in settings.sticky — no separate prefix.
];

/**
 * Lookup a manifest entry by key prefix.
 * @param {string} key  Raw db key
 * @returns {object|null}
 */
function getManifestEntry(key) {
  return STORAGE_MANIFEST.find((e) => key.startsWith(e.prefix)) ?? null;
}

/**
 * List all critical namespaces (used by /doctor storage check).
 * @returns {object[]}
 */
function getCriticalNamespaces() {
  return STORAGE_MANIFEST.filter((e) => e.critical);
}

module.exports = { STORAGE_MANIFEST, getManifestEntry, getCriticalNamespaces };
