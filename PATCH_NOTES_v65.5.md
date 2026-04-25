# PATCH NOTES — v65.5

## Help menu buttons not updating
- Fixed `safeUpdate()` to fall back to `deferUpdate()` + `editReply()` when `interaction.update()` fails.
- This prevents "button does nothing" behavior, especially on ephemeral help menus.
