# Role Panel Edit Button Fix

Fixes the **Unknown/expired button** error for the **Edit Panel Embed** button in `/rolepanel builder`.

Changes:
- Removed duplicate handler file `src/components/buttons/rolePanel.js` (Windows case-insensitivity caused unreliable loading).
- Unified role panel button handling into `src/components/buttons/rolepanel.js`.
- Builder now uses `customId = rolepanel:edit`.
- Backward compatible: older messages with `rolePanel:edit` still work.
- Interaction router now falls back to lowercase ids when resolving button/select/modal handlers.
