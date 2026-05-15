# Project Structure

## Phase 3 reorganisation

`src/utils/` was a 50-file dumping ground mixing data stores, UI builders,
infrastructure helpers, and service logic.  It has been split into four
directories with clear responsibilities.

### Canonical locations (post Phase 3)

```
src/
├── stores/          Data-access wrappers — read/write to Keyv/SQLite
│   ├── settings.js       Guild settings with schema migration + 30 s cache
│   ├── prefixStore.js    Thin wrapper — delegates to settings (no separate cache)
│   ├── ticketData.js     Active ticket records
│   ├── ticketV2Store.js  Ticket v2 state
│   ├── tickets.js        Ticket helpers
│   ├── warns.js          User warn lists
│   ├── modCases.js       Moderation case records
│   ├── modStats.js       Moderation statistics
│   ├── giveawayStore.js  Active giveaway records
│   └── tempRooms.js      Temporary voice room records
│
├── views/           Embed & UI builders — Discord message/component builders
│   ├── greetBuilderView.js
│   ├── leaveBuilderView.js
│   ├── helpBuilder.js
│   └── roomPanel.js
│
├── helpers/         Pure utilities and infrastructure helpers
│   ├── logger.js          Pino logger singleton
│   ├── metrics.js         In-process counter/gauge store
│   ├── asyncLock.js       Per-key async mutex
│   ├── safeMode.js        Per-guild circuit-breaker
│   ├── safeReply.js       Interaction reply with error handling
│   ├── safeRequire.js     require() that returns null on MODULE_NOT_FOUND
│   ├── reply.js           Generic reply helper
│   ├── duration.js        Time formatting
│   ├── placeholders.js    Template variable substitution
│   ├── isStaff.js / staffV2.js  Permission checks
│   ├── modules.js         Feature-flag / module enable checks
│   ├── parseUser.js       User mention/ID parsing
│   ├── auditFormat.js     Audit log embed formatting
│   ├── configValidator.js Bot configuration validation
│   ├── criticalErrorTracker.js  Repeated-error detection
│   ├── debouncer.js       Function debouncing
│   └── startupChecks.js   Boot-time environment validation
│
├── utils/           Transition shims (backward compat)
│   └── *.js         Each file is a one-liner: module.exports = require('../<new_dir>/X')
│                    Will be removed once all call-sites are updated to new paths.
│
├── services/        Orchestration — thin wrappers that add queue/lock management
│   ├── musicService.js    Wraps audioEngine.js with per-guild async queue
│   ├── ticketService.js
│   ├── moderationService.js
│   └── tempRoomService.js
│
├── app/             Infrastructure — boot, lifecycle, optional Phase 4/5 systems
│   ├── bootstrap.js       Application entry, Phase 4 opt-in initialisation
│   ├── redis.js           Redis client with URL validation (no-op if REDIS_URL absent)
│   ├── database.js        PostgreSQL client (Phase 5, optional)
│   └── ...
│
└── utils/audioEngine.js   Music engine (700 lines) — canonical name, no duplicate
```

### Migration path

All existing `require('../utils/X')` calls continue to work via the shim files.
When touching a file, update its imports to the canonical path (e.g.
`require('../stores/settings')` instead of `require('../utils/settings')`).
Once all call-sites are updated, the `utils/` shims can be deleted.

---

## Phase 4 additions

```
src/
├── shard.js             ShardingManager entry — use instead of index.js at scale
│
├── helpers/
│   └── ytDlpPool.js     Semaphore: caps concurrent yt-dlp spawns (YTDLP_MAX_CONCURRENT, default 8)
│
└── app/
    └── musicStateStore.js  Redis-ready persistence layer for guild music metadata
                            (stay247, voiceChannelId, textChannelId). In-process
                            Map today; swap implementation for Redis calls when sharding.

scripts/
└── migrate.js           PostgreSQL migration runner — tracks applied SQL files in
                         a _migrations table. Use: npm run migrate
```

### Sharding notes

Run `npm run start:shard` (uses `src/shard.js`) once you reach 500+ guilds.
The ShardingManager spawns worker processes that each run `src/index.js`.

**Music state and sharding**: `audioEngine.js` stores the live `AudioPlayer` and
`VoiceConnection` in process memory — those are OS resources and cannot be
shared.  The `musicStateStore` handles the *metadata* (247 mode, channel IDs)
that needs to survive across shards.  Each guild is assigned to exactly one
shard by Discord's auto-shard algorithm, so the in-process audio state is safe
as long as you do not route a guild to two shards simultaneously (the default
behaviour).

### yt-dlp concurrency

`ytDlpPool` (src/helpers/ytDlpPool.js) gates concurrent spawns globally.
Default cap is 8. Tune with `YTDLP_MAX_CONCURRENT` env var.
Requests beyond the cap queue and wait up to `YTDLP_QUEUE_TIMEOUT_MS` (30 s).
Pool stats are visible in `/dev diagnostics` and the health endpoint.
