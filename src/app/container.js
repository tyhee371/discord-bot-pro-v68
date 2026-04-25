const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const { logger } = require('../utils/logger');

function createContainer() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User, Partials.GuildMember],
  });

  client.commands = new Collection();
  client.components = {
    buttons: new Collection(),
    modals: new Collection(),
    selects: new Collection(),
  };

  return { client, logger };
}

module.exports = { createContainer };