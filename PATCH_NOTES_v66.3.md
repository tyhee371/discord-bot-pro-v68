# v66.3 Patch Notes

## Dev tools gating via Discord Developer Portal Team

- `/dev` is now restricted to members of the bot's **Discord Developer Portal Team**.
- The bot loads Team membership by calling Discord's application endpoint (`/oauth2/applications/@me`) using the bot token.
- You can also invite temporary testers by listing their user IDs in `BOT_DEV_USER_IDS`.
- Team membership is cached and refreshed periodically (default: every 360 minutes).

## Setup

- Put the bot in a Developer Portal Team **or** set `BOT_DEV_USER_IDS` in `.env`.
- (Optional) Set `BOT_DEV_GUILD_IDS` to limit `/dev` usage to specific guilds.
