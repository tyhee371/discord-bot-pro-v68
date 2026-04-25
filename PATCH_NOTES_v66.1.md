# PATCH_NOTES_v66.1

This maintenance update focuses on **reducing future bugs** and improving **visibility when something breaks**.

## Added
- **Process-level error reporting**: `unhandledRejection` and `uncaughtException` can now be reported to the configured `/dev errors` channel (if enabled).
- **Startup load error reporting**: any files that fail to load via `safeRequire()` are summarized and sent to the `/dev errors` channel when the bot becomes ready.
- **Safe Mode (auto-disable failing handlers)**:
  - New utility: `src/utils/safeMode.js`
  - New command: `/dev safemode` (dev/tester allowlist)
  - When enabled, repeatedly failing slash commands / buttons / selects / modals are temporarily disabled to prevent spam/crash loops.
  - Disables are announced in the `/dev errors` channel.

## How to use
1. Configure an error log channel:
   - `/dev errors setup channel:#your-log-channel`
2. Enable safe mode:
   - `/dev safemode on` (optional: set threshold/window/minutes)
3. Check status:
   - `/dev safemode status`
4. Re-enable everything:
   - `/dev safemode reset`
