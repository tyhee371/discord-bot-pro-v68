# PATCH_NOTES_v66.2

This update moves maintenance/dev tools behind a **dev/tester allowlist** so regular community members won’t see or use them.

## Changes
- Removed public `/errors` and `/safemode` commands.
- Added a single dev-only slash command: `/dev`
  - `/dev errors setup|off|test`
  - `/dev safemode on|off|status|reset`
- Added `src/utils/devAccess.js` with allowlist checks.
- `/help` hides dev-only commands unless the user is allowlisted.

## Configure dev access
Set at least one of these in `.env` (comma-separated IDs):
- `BOT_DEV_USER_IDS`
- `BOT_DEV_ROLE_IDS`

Optional:
- `BOT_DEV_GUILD_IDS` to limit `/dev` tools to specific server(s).

If both `BOT_DEV_USER_IDS` and `BOT_DEV_ROLE_IDS` are empty, `/dev` tools are blocked for everyone.
