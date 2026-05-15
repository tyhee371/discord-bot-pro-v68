const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const { logger } = require('../helpers/logger');

function createContainer() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      // GuildPresences is a privileged intent — kept because it's actively used:
      // - src/commands/utility/user.js: online status display
      // - src/helpers/staffV2.js: staff online presence routing
      // If either feature is removed in the future, this intent should be dropped.
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