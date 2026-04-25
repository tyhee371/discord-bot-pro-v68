const { Events } = require('discord.js');
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

      // If the bot itself was disconnected (kicked/moved out), clear music state
      if (member && member.id === botId) {
        const left = oldState.channelId && !newState.channelId;
        if (left) {
          await leave(guildId, 'Bot disconnected from voice');
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
