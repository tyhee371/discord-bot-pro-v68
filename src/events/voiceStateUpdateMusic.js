const { Events } = require('discord.js');
const { VoiceConnectionStatus, getVoiceConnection } = require('@discordjs/voice');
const { peekState, leave, scheduleAloneDisconnect, clearAloneTimer } = require('../services/musicService');
const { logger } = require('../utils/logger');

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(client, oldState, newState) {
    try {
      const botId = client.user?.id;
      if (!botId) return;

      const member = newState.member ?? oldState.member;
      const guildId = (newState.guild ?? oldState.guild)?.id;
      if (!guildId) return;

      // If the bot itself transitioned out of a voice channel, check whether
      // this is a real disconnect or a transient shard-resume blip.
      //
      // During a shard reconnect, Discord fires a VoiceStateUpdate with
      // newState.channelId = null briefly, even though the bot will rejoin
      // automatically.  Calling leave() here would kill the music state and
      // stop the yt-dlp process, ending playback mid-song.
      //
      // Guard: only call leave() if the @discordjs/voice connection is also
      // gone (destroyed / not present) at the time this event fires.  If the
      // connection object still exists and is not Destroyed, it means the shard
      // reconnect handler is managing the situation — don't interfere.
      if (member && member.id === botId) {
        const left = oldState.channelId && !newState.channelId;
        if (left) {
          // Give the connection state machine a tick to settle before deciding.
          // The VoiceStateUpdate can arrive before the VoiceConnection's own
          // stateChange event fires, so we wait one event-loop turn.
          await new Promise((r) => setImmediate(r));

          const conn = getVoiceConnection(guildId);
          const connGone =
            !conn ||
            conn.state.status === VoiceConnectionStatus.Destroyed ||
            conn.state.status === VoiceConnectionStatus.Disconnected;

          if (connGone) {
            // Also check that the music state agrees the channel is gone.
            const st = peekState(guildId);
            const stateAlsoGone = !st?.connection || st.connection.state?.status === VoiceConnectionStatus.Destroyed;
            if (stateAlsoGone) {
              logger.info({ guildId }, '[MUSIC] Bot left voice channel (confirmed hard disconnect) — clearing state');
              await leave(guildId, 'Bot disconnected from voice');
            } else {
              logger.info({ guildId }, '[MUSIC] VoiceStateUpdate showed bot left but connection still alive — ignoring (shard resume)');
            }
          } else {
            logger.info({ guildId, connStatus: conn.state.status }, '[MUSIC] VoiceStateUpdate showed bot left but connection exists — ignoring (shard resume)');
          }
        }
        return;
      }

      // For any voice movement in this guild, check if bot is now alone (only if it has a music state)
      const st = peekState(guildId);
      if (!st?.connection || !st?.client) return;

      // Only re-check when something happened in the bot's channel
      const channelId = st.connection.joinConfig.channelId;
      if (!channelId) return;

      if (oldState.channelId !== channelId && newState.channelId !== channelId) return;

      const ch =
        client.channels.cache.get(channelId) || (await client.channels.fetch(channelId).catch(() => null));
      if (!ch || !ch.members) return;

      const humans = ch.members.filter((m) => !m.user.bot).size;
      if (humans > 0) clearAloneTimer(st);
      else await scheduleAloneDisconnect(st, client);
    } catch (e) {
      logger.error({ err: e }, '[MUSIC] voiceStateUpdate error');
    }
  },
};
