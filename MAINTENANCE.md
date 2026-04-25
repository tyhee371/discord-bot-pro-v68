# Maintenance (keep the bot stable)

## 1) Install stability
Create and keep a lockfile:
```bash
npm install --package-lock-only
```
Commit `package-lock.json`. On servers, use:
```bash
npm ci
```

## 2) Monthly dependency updates
Once per month:
```bash
npm outdated
npm update
npm test
```
If music breaks on YouTube (403), update **yt-dlp** in `/bin`.

## 3) Health checks
Run:
- `/doctor` in your server (checks perms, modules, yt-dlp age)
- `/dev errors setup #bot-errors` to log crashes per command

## 4) Permissions changes
If ticket perms break, ensure:
- Bot role is above Mod/Admin roles used for tickets
- Bot has Manage Channels (for ticket channels/categories)

## 5) Module toggles
Use `/modules` to turn modules on/off per guild (music/logs/tickets etc).
