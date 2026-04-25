# Patch notes (v65.1)

This patch fixes the `npm run deploy:guild` / startup crash caused by a missing module,
and improves slash command deployment compatibility.

## Fixes

### 1) Added missing `src/utils/prefixStore.js`

Two files referenced `../../utils/prefixStore` but the module did not exist:

- `src/commands/utility/help.js`
- `src/components/selects/help.js`

This caused:

```
Error: Cannot find module '../../utils/prefixStore'
```

`prefixStore.js` is now implemented as a thin cached wrapper around `src/utils/settings.js`
so the prefix continues to be stored per-guild in your existing Keyv-backed settings.

### 2) Made `/help` deployable

`src/deploy-commands.js` only deploys commands whose `data` has a `.toJSON()` method.
The help command used a plain object for `data`, so `/help` was never registered.

`src/commands/utility/help.js` now uses `SlashCommandBuilder`.

### 3) Improved command loader compatibility

`src/handlers/loadCommands.js` now supports both:

- plain object commands (`data.name`)
- `SlashCommandBuilder` commands (`data.toJSON().name`)

This keeps runtime lookups consistent.

## v65.2
- Fix interactive help menu: add discoverSlashCommands/discoverPrefixCommands to helpBuilder and pass client into help select component.
