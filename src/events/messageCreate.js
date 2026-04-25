const { Events } = require('discord.js');
const { logger } = require('../utils/logger');
const { handlePrefixMessage } = require('../application/handlers/commandHandler');

module.exports = {
  name: Events.MessageCreate,
  async execute(client, message) {
    try {
      await handlePrefixMessage(client, message);
    } catch (err) {
      logger.error({ err, guildId: message.guild?.id, channelId: message.channelId, userId: message.author?.id }, '[messageCreate] error');
    }
  },
};
