# PATCH_NOTES_v66

Maintenance-focused release (stability + future-bug prevention).

## Changes (most important first)
1) Safe module loading (commands/components/events/deploy)
- New `src/utils/safeRequire.js`
- Loaders now catch `require()` failures and keep the bot running, logging a clear error instead of crashing.
- Duplicate command/component IDs are detected and skipped with warnings.

2) Event crash containment
- Event handlers are wrapped so exceptions do not crash the process; errors are logged with event name + file path.

3) Deploy script resilience
- `src/deploy-commands.js` now skips broken command modules rather than crashing.

4) Repo hygiene
- Added `.gitignore` (prevents leaking `.env` and committing `node_modules`)
- Added `.env.example`
- README setup note

Tip: run `npm run smoke` after adding/editing commands to catch load errors early.
