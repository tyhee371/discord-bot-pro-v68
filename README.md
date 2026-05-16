# Discord Bot Pro v68

A full-featured Discord bot built with **discord.js v14.25.1** for moderation, tickets, music, role panels, and interactive server utilities.

**Version:** 68.0.0  
**Node.js Requirement:** >=22.12.0

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Environment Configuration](#environment-configuration)
- [Docker & Compose](#docker--compose)
- [Deploying Slash Commands](#deploying-slash-commands)
- [Running the Bot](#running-the-bot)
- [Development & Maintenance](#development--maintenance)
- [Troubleshooting](#troubleshooting)
- [Support](#support)

---

## Overview

This repository contains a Discord bot with:
- moderation tools and mod logging
- ticket support panels
- temporary voice room management
- music playback across YouTube, Spotify, SoundCloud, and more
- role panels, greet/leave automation, giveaways, and utility commands
- Docker Compose support for Postgres, Redis, and monitoring

---

## Features

- ✅ Moderation: `/warn`, `/ban`, `/kick`, `/timeout`, `/clear`, `/modlogs`
- ✅ Ticket system: ticket creation, panels, transcripts, archive
- ✅ Music playback: `/music` queue, skip, pause, resume, 24/7 mode
- ✅ Temporary voice room management: `/room` controls
- ✅ Role panels: self-assign roles via buttons and selects
- ✅ Greeting/leave messages with templates and previews
- ✅ Giveaways with reaction entry and reroll support
- ✅ Utility commands: `/help`, `/doctor`, `/ping`, `/avatar`, `/server`
- ✅ Monitoring stack with Prometheus and Grafana profiles
- ✅ Dockerized production and local development setup

---

## Requirements

- Node.js 22.12.0 or higher
- npm (bundled with Node.js)
- FFmpeg for music playback
- Docker + Docker Compose for containerized deployment

---

## Quick Start

1. Clone the repository:
```bash
git clone <repository-url>
cd discord-bot-pro-v68
```

2. Install dependencies:
```bash
npm install --include=optional --legacy-peer-deps
```

3. Copy the environment template:
```bash
cp .env.example .env
```

4. Update `.env` with your bot token and service credentials.

5. Deploy commands for testing:
```bash
npm run deploy:guild
```

6. Start the bot:
```bash
npm start
```

---

## Environment Configuration

Copy `.env.example` to `.env` and fill in your values.

Required values in production or Docker:

```env
DISCORD_TOKEN=your_discord_token
CLIENT_ID=your_client_id
GUILD_ID=your_test_guild_id
REDIS_PASSWORD=your_redis_password
REDIS_URL=redis://:your_redis_password@redis:6379
POSTGRES_PASSWORD=your_postgres_password
DATABASE_URL=postgresql://bot_user:your_postgres_password@postgres:5432/bot_db
PGADMIN_PASSWORD=your_pgadmin_password
GRAFANA_PASSWORD=your_grafana_password
```

Optional values:

```env
OWNER_IDS=comma_separated_owner_ids
KEYV_URL=sqlite://database.sqlite
YTDLP_MAX_CONCURRENT=8
YTDLP_QUEUE_TIMEOUT_MS=30000
YTDLP_COOKIES_FILE=./cookies.txt
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SHARD_COUNT=1
SHARD_DELAY_MS=5500
ACTIVITY_ROTATE_MS=30000
ACTIVITY_TEXT=!help or /help to see commands
STREAM_URL=https://twitch.tv/discord
BOT_DEV_USER_IDS=your_user_id
BOT_DEV_GUILD_IDS=your_guild_id
BOT_DEV_CACHE_MINUTES=360
PRIVACY_POLICY_URL=https://example.com/privacy
TERMS_URL=https://example.com/terms
```

> Use internal Docker hostnames (`redis`, `postgres`) when running with Docker Compose.

---

## Docker & Compose

This repo includes `docker-compose.yml` with profiles for production, development, and monitoring.

### Production bot only

```bash
docker compose --profile bot up -d
```

### Local development with host port access

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile bot --profile dev up -d
```

### Start monitoring stack

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile monitoring up -d
```

### Recommended local start

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile bot --profile monitoring up -d
```

### Service endpoints

- Bot health: `http://localhost:3000/health`
- PgAdmin: `http://localhost:8080`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001`

---

## Deploying Slash Commands

Use guild deployment for immediate command registration in a specific server:

```bash
npm run deploy:guild
```

Use global deployment for production-wide registration (may take 1-2 hours to propagate):

```bash
npm run deploy:global
```

For cleanup and refresh:

```bash
npm run deploy:clear-guild
```

---

## Running the Bot

Single instance mode:

```bash
npm start
```

Sharded mode:

```bash
npm run start:shard
```

Migration utility:

```bash
npm run migrate
```

Health check and diagnostics:

```bash
npm run doctor
```

---

## Development & Maintenance

### Tests

```bash
npm run smoke
npm test
```

### Code quality

```bash
npm run lint
npm run format
```

### Logs

Logs are written to `./logs/app-YYYY-MM-DD.log`.

Watch the latest log output:

```bash
Get-Content .\logs\app-*.log -Tail 100
```

---

## Troubleshooting

### Bot fails to start

- Confirm `.env` exists and contains `DISCORD_TOKEN`, `DATABASE_URL`, `REDIS_URL`, and `POSTGRES_PASSWORD`.
- Check logs:

```bash
docker compose logs -f discord-bot
```

### Database connection issues

- Verify PostgreSQL is healthy:

```bash
docker compose exec postgres pg_isready -U bot_user -d bot_db
```

- Confirm `DATABASE_URL` uses `postgres` service name inside Docker.

### Redis connection issues

- Verify Redis is healthy:

```bash
docker compose exec redis redis-cli -a "$env:REDIS_PASSWORD" ping
```

- Confirm `REDIS_URL` is `redis://:password@redis:6379`.

### Music playback or DAVE issues

- Install optional dependencies:

```bash
npm install --include=optional --legacy-peer-deps
```

- Ensure FFmpeg is installed and `yt-dlp` is available for YouTube playback.

---

## Support

For issues or feature requests, open a GitHub issue and include:
- bot version: `68.0.0`
- Node version: `>=22.12.0`
- exact error message and relevant logs from `./logs`

---

## License

This project is provided as-is for personal and server use.
