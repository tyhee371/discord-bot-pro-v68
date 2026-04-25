# Discord Bot Pro (WITH MUSIC v20)

This build focuses on **stable installs on Windows/Node 24** and a more complete **multi-source music system**.

## What changed (v5)
### Music
- ✅ YouTube video links + search
- ✅ YouTube **playlists** (adds up to 200 tracks)
- ✅ YouTube Music links (music.youtube.com) normalized and supported
- ✅ SoundCloud track + playlist links (auto-sets a free client_id at runtime)
- ✅ Spotify links:
  - **Track links**: matched to a YouTube result and played (Spotify → YouTube)
  - **Playlist/Album links**: supported **if** Spotify tokens are configured (see below)
- ✅ Adds `/music pause` and `/music resume`
- ✅ Skips broken tracks automatically (won’t get stuck on an invalid URL)

### Install (Windows)
```powershell
# Windows (Node 20/22 recommended; Node 24 works in this build)
# IMPORTANT: do NOT omit optional deps, because @snazzah/davey is required for the new DAVE protocol.
# Clean install (recommended if you hit voice/DAVE errors):
Remove-Item -Recurse -Force .\node_modules -ErrorAction SilentlyContinue
Remove-Item -Force .\package-lock.json -ErrorAction SilentlyContinue

npm install --include=optional --legacy-peer-deps
```

## Deploy commands
```powershell
npm run deploy:guild
# or
npm run deploy:global
```

## Voice dependency doctor (debug)
```powershell
npm run doctor
```

---

## Maintenance & Dev
```powershell
# Health check (slash command): /doctor
# CLI doctor:
npm run doctor

# Smoke test (loads every module to catch syntax/import errors)
npm run smoke

# Unit tests
npm test

# Lint / format
npm run lint
npm run format
```

Logs are written to `./logs/app-YYYY-MM-DD.log` (and also printed to console).

## Music Commands
- `/music play <query|url>`
- `/music now`
- `/music queue`
- `/music skip`
- `/music pause`
- `/music resume`
- `/music stop`
- `/music volume <0.1-2.0>` (staff only)
- `/music 247 on|off`
- `/music leave` (staff only)

### Spotify playlist/album support (optional)
Spotify playlists/albums require Spotify tokens. If you want that:
1) Run once on your machine:
```powershell
node -e "require('play-dl').authorization()"
```
2) Follow the output instructions from play-dl to set Spotify credentials/tokens, then add them to your `.env` / token setup.

(Spotify *tracks* can still work without credentials via the oEmbed → YouTube match fallback.)



## Ticket Panel Embed Builder
Use `/ticket panel-builder` then click **Edit Panel Embed**.

## Voice / 24-7 troubleshooting (DAVE)
If you see:
`Cannot utilize the DAVE protocol as the @snazzah/davey package has not been installed`

**Cause (most common):** optional dependencies were omitted (e.g. `.npmrc` had `optional=false` or you installed with `--omit=optional`).

Fix (run in the folder with package.json):
```powershell
rmdir /s /q node_modules 2>$null
del package-lock.json 2>$null
npm config set optional true
npm install --include=optional --legacy-peer-deps

# verify
npm run doctor
```


## Ticket Panel Builder
Use `/ticket panel-builder` and the **Edit Panel Embed** button.

- `/ticket panel-set` removed (use builder).

- Fixed `/ticket panel-builder` to work with deferred replies.

## Fix DAVE protocol error (Node 24)
Same fix as above: reinstall with optional deps enabled, then run `npm run doctor`.


### YouTube 403 / "Could not parse decipher function" warnings
YouTube changes frequently. When this happens, **ytdl-core** can temporarily break and you'll see warnings about decipher/n-transform functions and errors like **Status code: 403**.

This build supports a **recommended fallback: `yt-dlp`** for YouTube playback. When `yt-dlp` is available, the bot will try it **first** for YouTube links.

**How to set up `yt-dlp` (Windows):**
- Download `yt-dlp.exe` from the official **yt-dlp GitHub Releases**
- Put it here: `discord-bot-pro/bin/yt-dlp.exe`
  - OR put it anywhere and set `YTDLP_PATH=full\path\to\yt-dlp.exe` in `.env`
  - OR install it globally and make sure `yt-dlp.exe` is in your PATH

After that, retry `/music play <youtube link>` and the 403/decipher warnings should stop for most tracks.

## Setup
- Copy `.env.example` to `.env` and fill in values.
- Run `npm install`, then `npm run deploy:guild`, then `npm start`.
- Run `npm run smoke` after adding new commands/components to catch load errors early.
