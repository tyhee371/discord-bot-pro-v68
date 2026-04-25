# Discord Bot Pro v68

A feature-rich Discord bot built with **discord.js v14.25.1** featuring music playback, moderation tools, ticket systems, role management, and more.

**Latest Version:** 68.0.0  
**Node.js Requirement:** >=22.12.0

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [Commands](#commands)
  - [Music Commands](#music-commands)
  - [Moderation Commands](#moderation-commands)
  - [Ticket Commands](#ticket-commands)
  - [Greet/Leave Commands](#greetleave-commands)
  - [Role Commands](#role-commands)
  - [Room Commands](#room-commands)
  - [Fun Commands](#fun-commands)
  - [Utility Commands](#utility-commands)
  - [Giveaway Commands](#giveaway-commands)
  - [Developer Commands](#developer-commands)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## Features

✅ **Multi-Source Music System** - YouTube, YouTube Music, Spotify, SoundCloud, and more  
✅ **Advanced Moderation** - Warnings, timeouts, bans, kicks, and logging  
✅ **Ticket Management** - Create, manage, and archive tickets with custom panels  
✅ **Role Management** - Role panels with button-based role assignment  
✅ **Temporary Voice Channels** - Auto-managed voice rooms  
✅ **Greeting/Leave Messages** - Customizable welcome and goodbye messages  
✅ **Giveaway System** - Create and manage giveaways  
✅ **24/7 Voice Support** - DAVE protocol support for continuous voice connectivity  
✅ **Moderation Logging** - Comprehensive mod case tracking and history  
✅ **Utility Features** - Server info, user profiles, starboard, sticky messages, and more

---

## Installation

### Prerequisites

- Node.js 22.12.0 or higher
- FFmpeg (for music playback)
- Discord Bot Token
- Optional: yt-dlp (for improved YouTube playback)

### Windows Installation

```powershell
# Clone the repository
git clone <repo-url>
cd discord-bot-pro-v68

# Clean install (recommended)
Remove-Item -Recurse -Force .\node_modules -ErrorAction SilentlyContinue
Remove-Item -Force .\package-lock.json -ErrorAction SilentlyContinue

# Install dependencies (include optional deps for DAVE protocol)
npm install --include=optional --legacy-peer-deps

# Copy environment configuration
Copy-Item .env.example .env

# Deploy commands
npm run deploy:guild

# Start the bot
npm start
```

### Linux/macOS Installation

```bash
# Clone the repository
git clone <repo-url>
cd discord-bot-pro-v68

# Clean install
rm -rf node_modules package-lock.json

# Install dependencies
npm install --include=optional --legacy-peer-deps

# Copy environment configuration
cp .env.example .env

# Deploy commands
npm run deploy:guild

# Start the bot
npm start
```

---

## Configuration

### Environment Variables (.env)

```env
# Bot Token
DISCORD_TOKEN=your_bot_token_here

# Spotify Credentials (optional, for Spotify playlist/album support)
SPOTIFY_CLIENT_ID=your_spotify_id
SPOTIFY_CLIENT_SECRET=your_spotify_secret
SPOTIFY_REFRESH_TOKEN=your_spotify_token

# YouTube DLP Path (optional, for improved YouTube playback)
YTDLP_PATH=/path/to/yt-dlp

# Database Configuration
DATABASE_URL=your_database_url

# Logging Level
LOG_LEVEL=info
```

### Setup Spotify Playlist Support

1. Run the Spotify authorization:
```powershell
node -e "require('play-dl').authorization()"
```

2. Follow the prompted instructions to authenticate
3. Add the tokens to your `.env` file

### Setup yt-dlp (for improved YouTube playback)

1. Download `yt-dlp.exe` from [yt-dlp GitHub Releases](https://github.com/yt-dlp/yt-dlp/releases)
2. Place it in: `discord-bot-pro/bin/yt-dlp.exe`
   - OR set `YTDLP_PATH=full\path\to\yt-dlp.exe` in `.env`
   - OR install globally and ensure it's in your PATH
3. Verify with: `npm run doctor`

---

## Commands

All commands use Discord's slash command system (`/`).

### Music Commands

Play music from multiple sources with full queue management.

| Command | Description | Usage |
|---------|-------------|-------|
| `/music play` | Play a song from YouTube, Spotify, SoundCloud, etc. | `/music play [query or URL]` |
| `/music now` | Display current playing track | `/music now` |
| `/music queue` | View the current song queue | `/music queue` |
| `/music skip` | Skip the current track | `/music skip` |
| `/music pause` | Pause playback | `/music pause` |
| `/music resume` | Resume playback | `/music resume` |
| `/music stop` | Stop music and disconnect | `/music stop` |
| `/music volume` | Set playback volume (0.1-2.0) | `/music volume [0.1-2.0]` **[Staff Only]** |
| `/music 247` | Enable/disable 24/7 mode | `/music 247 [on\|off]` |
| `/music leave` | Make bot leave voice channel | `/music leave` **[Staff Only]** |

**Supported Sources:**
- 🎵 YouTube videos & search
- 🎵 YouTube playlists (up to 200 tracks)
- 🎵 YouTube Music links
- 🎵 Spotify tracks (matched to YouTube)
- 🎵 Spotify playlists & albums (with credentials)
- 🎵 SoundCloud tracks & playlists

---

### Moderation Commands

Comprehensive moderation tools for server management.

| Command | Description | Usage |
|---------|-------------|-------|
| `/warn` | Warn a member | `/warn [user] [reason]` |
| `/warn list` | View member warnings | `/warn list [user]` |
| `/warn remove` | Remove a warning | `/warn remove [user] [case_id]` |
| `/warn clear` | Clear all warnings for a user | `/warn clear [user] [reason]` |
| `/ban` | Ban a member from the server | `/ban [user] [reason]` |
| `/kick` | Kick a member from the server | `/kick [user] [reason]` |
| `/timeout` | Timeout a member | `/timeout [user] [duration] [reason]` |
| `/clear` | Delete messages in bulk | `/clear [amount] [user (optional)]` |
| `/automod` | Configure automod settings | `/automod [enable\|disable] [type]` |
| `/modlogs` | View moderation logs | `/modlogs [user (optional)] [page (optional)]` |
| `/modcase` | View specific mod case | `/modcase [case_id]` |
| `/logs` | Search moderation logs | `/logs [user (optional)] [action (optional)]` |
| `/verify` | Setup or manage verification system | `/verify [setup\|configure]` |

---

### Ticket Commands

Complete ticket system for support and management.

| Command | Description | Usage |
|---------|-------------|-------|
| `/ticket` | Main ticket management command | `/ticket [subcommand]` |
| `/ticket create` | Create a new ticket | `/ticket create [type]` |
| `/ticket panel-builder` | Create a custom ticket panel | `/ticket panel-builder` |
| `/ticket add` | Add a user to ticket | `/ticket add [user]` |
| `/ticket remove` | Remove a user from ticket | `/ticket remove [user]` |
| `/ticket-done` | Mark ticket as done | `/ticket-done` |
| `/transcript` | Generate ticket transcript | `/transcript [format]` |

**Features:**
- Custom panel embeds
- Role-based access control
- Automatic archival
- HTML transcripts

---

### Greet/Leave Commands

Set up welcome and goodbye messages.

| Command | Description | Usage |
|---------|-------------|-------|
| `/greet` | Configure greeting messages | `/greet [enable\|disable] [channel]` |
| `/greet set` | Set custom greeting message | `/greet set [message]` |
| `/greet preview` | Preview greeting message | `/greet preview` |
| `/leave` | Configure leave messages | `/leave [enable\|disable] [channel]` |
| `/leave set` | Set custom leave message | `/leave set [message]` |
| `/leave preview` | Preview leave message | `/leave preview` |

**Message Variables:**
- `{user}` - Member mention
- `{username}` - Member username
- `{server}` - Server name
- `{membercount}` - Total members

---

### Role Commands

Manage roles and create self-assignment panels.

| Command | Description | Usage |
|---------|-------------|-------|
| `/role` | Assign/remove roles | `/role [user] [role] [add\|remove]` |
| `/rolepanel` | Create role assignment panel | `/rolepanel [create\|edit\|delete]` |
| `/rolepanel add` | Add role to panel | `/rolepanel add [panel] [role] [emoji]` |
| `/rolepanel remove` | Remove role from panel | `/rolepanel remove [panel] [role]` |

**Features:**
- Button-based role assignment
- Dropdown menus support
- Custom embed design
- Max role limits

---

### Room Commands

Manage temporary voice channels.

| Command | Description | Usage |
|---------|-------------|-------|
| `/room` | Create temporary voice room | `/room [name]` |
| `/room list` | View active rooms | `/room list` |
| `/room config` | Configure room settings | `/room config [setting] [value]` |
| `/room close` | Close a temporary room | `/room close` |

**Features:**
- Auto-delete empty rooms
- Customizable names
- Member limits
- Persistent configuration

---

### Fun Commands

Fun interactive commands for server engagement.

| Command | Description | Usage |
|---------|-------------|-------|
| `/bite` | Bite someone | `/bite [user]` |
| `/blush` | Blush animation | `/blush` |
| `/cry` | Cry animation | `/cry` |
| `/cuddle` | Cuddle someone | `/cuddle [user]` |
| `/dance` | Dance animation | `/dance` |
| `/hug` | Hug someone | `/hug [user]` |
| `/kiss` | Kiss someone | `/kiss [user]` |
| `/pat` | Pat someone | `/pat [user]` |
| `/poke` | Poke someone | `/poke [user]` |
| `/slap` | Slap someone | `/slap [user]` |
| `/smile` | Smile animation | `/smile` |
| `/tickle` | Tickle someone | `/tickle [user]` |
| `/wave` | Wave animation | `/wave` |

---

### Utility Commands

General utility and information commands.

| Command | Description | Usage |
|---------|-------------|-------|
| `/avatar` | Get user avatar | `/avatar [user (optional)]` |
| `/user` | Get user information | `/user [user (optional)]` |
| `/server` | Get server information | `/server` |
| `/ping` | Check bot latency | `/ping` |
| `/help` | Get command help | `/help [command (optional)]` |
| `/modules` | View enabled modules | `/modules` |
| `/doctor` | System health check | `/doctor` |
| `/embed` | Create custom embed | `/embed` |
| `/prefix` | Set command prefix | `/prefix [new_prefix]` |
| `/starboard` | Configure starboard | `/starboard [enable\|disable]` |
| `/sticky` | Make a sticky message | `/sticky [channel] [message]` |

---

### Giveaway Commands

Create and manage giveaways.

| Command | Description | Usage |
|---------|-------------|-------|
| `/giveaway` | Main giveaway command | `/giveaway [subcommand]` |
| `/giveaway create` | Create a giveaway | `/giveaway create [prize] [duration] [winners]` |
| `/giveaway end` | End giveaway immediately | `/giveaway end [message_id]` |
| `/giveaway reroll` | Reroll giveaway winners | `/giveaway reroll [message_id]` |
| `/giveaway list` | View active giveaways | `/giveaway list` |

**Features:**
- Reaction-based entry
- Automatic winner selection
- Reroll capability
- Customizable duration

---

### Developer Commands

Administrative and development commands.

| Command | Description | Usage | Restrictions |
|---------|-------------|-------|--------------|
| `/dev eval` | Evaluate JavaScript code | `/dev eval [code]` | **Bot Owner Only** |
| `/dev reload` | Reload commands/events | `/dev reload [module]` | **Bot Owner Only** |
| `/dev status` | Set bot status | `/dev status [text] [type]` | **Bot Owner Only** |
| `/dev ping` | Get API latency | `/dev ping` | **Bot Owner Only** |

---

## Deployment

### Deploy Commands to Guild (Testing)

```powershell
npm run deploy:guild
```

This registers commands for faster testing (guild-specific, instant updates).

### Deploy Commands Globally

```powershell
npm run deploy:global
```

This registers commands globally (takes 1-2 hours to propagate everywhere).

---

## Development & Maintenance

### Check System Health

```powershell
# CLI health check
npm run doctor

# In-Discord check
/doctor
```

### Run Tests

```powershell
# Smoke test (loads all modules)
npm run smoke

# Unit tests
npm test
```

### Code Quality

```powershell
# Lint code
npm run lint

# Format code
npm run format
```

### Logs

Logs are automatically written to `./logs/app-YYYY-MM-DD.log` and printed to console.

View logs:
```powershell
Get-Content .\logs\app-*.log -Tail 100  # Last 100 lines
```

---

## Troubleshooting

### DAVE Protocol Error

**Error:** `Cannot utilize the DAVE protocol as the @snazzah/davey package has not been installed`

**Fix:**
```powershell
rmdir /s /q node_modules 2>$null
del package-lock.json 2>$null
npm config set optional true
npm install --include=optional --legacy-peer-deps
npm run doctor
```

### Voice/Music Not Working

1. Install FFmpeg from [ffmpeg.org](https://ffmpeg.org)
2. Run: `npm run doctor`
3. Verify optional dependencies are installed
4. Check firewall settings (UDP port access)

### YouTube 403 / Decipher Errors

YouTube frequently updates its protection, causing temporary playback issues.

**Solution:** Setup yt-dlp as a fallback (see [Configuration](#configuration))

If using yt-dlp:
```powershell
# Download yt-dlp.exe
# Place in: discord-bot-pro/bin/yt-dlp.exe
# Test with: npm run doctor
/music play https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

### Node 24 Compatibility Issues

Ensure you're using the correct installation method:

```powershell
# Force clean install with optional deps
npm config set optional true
npm install --include=optional --legacy-peer-deps
npm run doctor
```

### Database Connection Issues

1. Verify `DATABASE_URL` in `.env`
2. Check database service is running
3. Test connection with `/doctor`
4. Review logs: `./logs/app-*.log`

### Command Not Responding

1. Check guild command deployment: `npm run deploy:guild`
2. Restart bot: `npm start`
3. Clear Discord client cache (Log out/in)
4. Check permissions: Bot needs `applications.commands` scope

---

## Support & Contribution

For issues, bugs, or feature requests, please open a GitHub issue with:
- Bot version (`discord-bot-pro v68`)
- Detailed error message
- Steps to reproduce
- Relevant logs from `./logs/app-*.log`

---

## License

This project is provided as-is for personal and server use.

---

**Last Updated:** 2026-04-25  
**Version:** 68.0.0  
**Built with:** discord.js v14.25.1
