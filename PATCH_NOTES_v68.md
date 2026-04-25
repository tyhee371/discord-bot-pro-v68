# Discord Bot Pro — v68 Patch Notes

## Overview

v68 is a full stability, bug-fix, and feature-completion release targeting all critical failures
identified in v67. The bot is now production-ready with stable interaction handling, a working
music system, a fully functional ticket/role-panel builder system, and a robust moderation system.

---

## 🔴 Critical Bug Fixes

### 1. `getPath` / `writeSettings` Missing from `settings.js` Exports
- **Root cause:** `warn.js` imported `{ getGuildSettings, getPath }` from `settings.js`, but
  `getPath` was never defined or exported. Every `/warn add` call crashed immediately.
- **Fix:** Added `getPath(obj, dotPath, defaultValue)` utility and `writeSettings` alias to
  `settings.js`, defined before `module.exports` so they are always available.

### 2. Ticket Builder — Remove Not Persisting
- **Root cause:** The remove modal handler used `delete builders[builderId]` then called
  `updateSettings()` which internally uses `deepMerge`. Deep merge cannot delete keys — the
  deleted builder was always re-merged back from the existing settings object.
- **Fix:** Now uses `JSON.parse(JSON.stringify(settings))` for a clean deep-clone, deletes the
  key from the clone, then calls `putGuildSettings()` which replaces the full document.

### 3. Ticket Panel Options — Remove Not Persisting
- **Same root cause as #2.** `ticketPanelList` modal handler also used `updateSettings`.
- **Fix:** Same approach — deep-clone + `putGuildSettings`.

### 4. Ticket Preview — Select Menu Crash (`StringSelectMenuBuilder.addOptions`)
- **Root cause:** Options with missing/empty `label` or `value`, or values exceeding 100 chars,
  caused Discord.js to throw during `addOptions`.
- **Fix:** Added strict validation in `buildTicketPanelPreview`:
  - Filters out options where `label` or `value` is empty or exceeds 100 characters
  - Deduplicates values automatically
  - Falls back to `'No options yet'` placeholder option when no valid options exist

### 5. `TimeoutNegativeWarning` in Music System
- **Root cause:** Calculated timeout values could go negative in edge cases.
- **Fix:** Added `safeTimeout(fn, delayMs)` wrapper using `Math.max(0, delayMs)` for all
  timer scheduling in `musicService.js`. Also fixed `greet.js` auto-delete timer.

### 6. Silent Music Playback (Volume = 0)
- **Root cause:** `resource.volume.setVolume(st.volume)` was called without a minimum clamp;
  if `st.volume` somehow became `0`, playback would be silent.
- **Fix:** Volume is now clamped to `Math.max(0.01, Math.min(2, volume))` before applying.

### 7. Voice Disconnect — No Auto-Reconnect (24/7 Mode)
- **Root cause:** On hard disconnect, the bot destroyed the connection and did nothing more.
  24/7 mode had no recovery path.
- **Fix:** When 24/7 is enabled and a hard disconnect occurs, the bot schedules a rejoin
  attempt after 3 seconds. If successful, the current track is re-queued at the front and
  playback resumes automatically.

### 8. Interaction Error Spam
- **Root cause:** Unhandled errors in interaction handlers produced "There was an error..."
  with no useful context.
- **Fix:** Global error handler now logs `console.error('[ERROR]', err)` and replies with
  `❌ An error occurred while executing this interaction.` using `followUp` when already
  deferred/replied, or `safeReply` otherwise.

---

## ⚖️ Moderation System

### Jail Role System (Warn → Jail)
- **Already implemented in v67 and verified correct in v68.**
- When warn count reaches a configured threshold, the jail role is applied automatically.
- Duration is stored via `prisonService` and removed by `prisonScheduler` on a 10s poll.
- Removing all warnings via `/warn clear` or `/warn remove` immediately removes the jail role
  if warn count drops below all configured thresholds.
- Duration format `HH:MM:SS` is supported via existing `parseDuration` utility.

---

## 🎫 Ticket System

### Removed Deprecated Commands
- `/ticket builder-delete` — already removed in v67, confirmed absent in v68
- `/ticket builder-preview` — already removed in v67, confirmed absent in v68

### `/ticket builder-list` — Fully Working
- Shows all builders in an embed with option counts and sent panel counts.
- **Preview** button → modal asks for builder ID → shows embed + select menu preview
- **Edit** button → modal asks for builder ID → opens embed edit modal
- **Remove** button → modal asks for builder ID → **now correctly deletes and persists**

### `/ticket panel-list` — Fully Working
- Lists all ticket options grouped by builder.
- **Edit Option** button → modal to update label/description/value by index
- **Remove Option** button → **now correctly deletes and persists**

### `/ticket panel-send` / `/ticket builder-resend`
- Sends or updates an existing panel message using `message_id`.

---

## 🎭 Role Panel System

### Removed
- `/rolepanel remove` subcommand — removed per spec

### Added
- `/rolepanel builder-list` — shows panel info embed with three buttons:
  - **Preview** — ephemeral embed showing current embed config + role list
  - **Edit Embed** — opens the embed editor modal
  - **Remove All** — clears all role options from the panel

### Button Handlers (`rolepanel:builder:*`)
- `rolepanel:builder:preview` — shows a preview embed with role list
- `rolepanel:builder:edit` — opens the embed builder modal
- `rolepanel:builder:remove` — clears all role options (requires `ManageRoles`)

---

## 🎵 Music System

### Removed
- `/music volume` — already absent in v67, confirmed absent in v68

### Stabilization
- `safeTimeout()` wrapper prevents `TimeoutNegativeWarning` on all timers
- Volume clamped to `[0.01, 2.0]` range — no more silent playback
- 24/7 mode auto-rejoins on disconnect and resumes current track
- Queue safely handles empty state
- Skip correctly sets `ignoreLoopOnce` before advancing

---

## 🧱 Core System

### `settings.js`
- `getPath(obj, dotPath, defaultValue)` — safely reads nested properties
- `writeSettings(guildId, patch)` — alias for `setGuildSettings` (backward compat)
- Both defined before `module.exports` (Node.js CJS safe)

### Global Error Handler (`interactionCreate.js`)
- All interaction errors now log with `console.error('[ERROR]', err)`
- Reply uses `followUp` (when deferred) or `safeReply` (fresh) — never double-replies
- Covers: slash commands, buttons, select menus, channel selects, modals

---

## 📦 Setup

```bash
npm install
node src/deploy-commands.js
node src/index.js
```

---

## ⚠️ Remaining Limitations

- Music playback requires `yt-dlp` binary in `bin/` folder OR `play-dl` working correctly.
  YouTube frequently breaks ytdl-core; yt-dlp is the recommended backend.
- Role panel uses a single shared panel per guild (no multi-builder support for roles).
  Full multi-builder role panel architecture would require a migration similar to the
  ticket builder system — recommended as a v69 feature.
- Prison scheduler polls every 10 seconds; very short durations (< 10s) may have up to 10s
  of overshoot before the jail role is removed.

---

## 🚀 Optional Future Upgrades

- Web dashboard for visual embed/panel configuration
- MongoDB backend instead of JSON flat-file DB
- Anti-crash/process manager (PM2 with `--restart-delay`)
- Sharding support for large bots (> 2500 guilds)

---

## 🎭 Role Panel — Full Multi-Builder Rework (v68 Addition)

The entire role panel system has been rewritten to match the ticket system architecture exactly.

### Data Structure (per guild)
```json
{
  "rolePanel": {
    "builders": {
      "vip": {
        "id": "vip",
        "name": "VIP Roles",
        "embed": {},
        "options": [{ "roleId": "123", "label": "VIP", "description": "..." }],
        "sent": [{ "channelId": "...", "messageId": "...", "sentAt": 1700000000000 }],
        "createdAt": 1700000000000,
        "updatedAt": 1700000000000
      }
    }
  }
}
```

### Legacy Migration
Guilds with the old single `rolePanel.panel` format are automatically migrated to a `default`
builder on first use. No data is lost.

### New Commands

| Command | Description |
|---------|-------------|
| `/rolepanel panel-builder [builder_id]` | Create a new role panel builder |
| `/rolepanel builder-list` | List all builders — Preview / Edit / Remove buttons |
| `/rolepanel add role/roles [builder_id]` | Add roles to a builder |
| `/rolepanel list [builder_id]` | List options — Edit / Remove buttons |
| `/rolepanel send channel [builder_id]` | Send panel to a channel |
| `/rolepanel resend [builder_id] [message_id] [channel]` | Update existing panel message |

### Removed Commands
- `/rolepanel remove` — removed per spec (use `/rolepanel list` → Remove button instead)

### New Component Files
- `buttons/rolepanelBuilderList.js` — Preview/Edit/Remove modal trigger
- `buttons/rolepanelList.js` — Edit/Remove option modal trigger
- `buttons/rolepanelPanel.js` — Edit embed button → opens embed modal
- `modals/rolepanelBuilderList.js` — handles builder preview, edit, and delete
- `modals/rolepanelList.js` — handles option edit and remove (with `putGuildSettings`)
- `modals/rolepanelPanelBuilder.js` — saves embed edits and updates live preview message
- `selects/rolepanel.js` — updated to handle per-builder `rolepanel:select:<builderId>` customIds
