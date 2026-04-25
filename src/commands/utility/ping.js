const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Replies with Pong!'),
  cooldownSeconds: 3,
  async execute(interaction, client) {
    await interaction.editReply(`Pong! WS: ${client.ws.ping}ms`);
  },
};
