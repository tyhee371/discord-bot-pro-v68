const { SlashCommandBuilder } = require('discord.js');
const { buildActionEmbed } = require('../../utils/actionService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blush')
    .setDescription('Blush at someone')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Target user (optional)').setRequired(false),
    ),
  cooldownSeconds: 2,
  moduleKey: 'fun',
  async execute(interaction, client) {
    const target = interaction.options.getUser('user') || null;
    const emb = await buildActionEmbed({
      action: 'blush',
      actorUser: interaction.user,
      targetUser: target,
      guild: interaction.guild,
    });

    return interaction.editReply({ embeds: [emb] });
  },
};
