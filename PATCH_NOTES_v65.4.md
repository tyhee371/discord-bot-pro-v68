# v65.4 Patch Notes

## Help menu
- Fixed pager buttons (Prev/Home/Next) not responding: removed invalid `content: ''` payload in component updates.

## Ticket v2
- Restored staff claim rotation without spamming extra embed messages:
  - The FIRST ticket message is edited to show Claim attempt 1/3 → 3/3.
  - Opener mention stays on the message so the ticket is always tied to the user.
- Staff ping rotates through candidates from the configured Admin/Mod roles.
  - To actually notify staff (Discord doesn't reliably notify on mentions added via edit), the bot sends a ping-only message and auto-deletes it after ~4s.
- Auto-delete for unclaimed tickets now uses the configured `claim_timeout_seconds` as the deletion grace period after the 3rd attempt.
- Added explicit bot permission overwrite on ticket channels to avoid missing perms when bot isn't Administrator.
