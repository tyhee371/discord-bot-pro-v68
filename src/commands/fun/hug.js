const { SlashCommandBuilder } = require('discord.js');
const { buildActionEmbed } = require('../../utils/actionService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hug')
    .setDescription('Hug someone')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Target user (optional)').setRequired(false),
    ),
  cooldownSeconds: 2,
  moduleKey: 'fun',
  async execute(interaction, client) {
    const target = interaction.options.getUser('user') || null;
    const emb = await buildActionEmbed({
      action: 'hug',
      actorUser: interaction.user,
      targetUser: target,
      guild: interaction.guild,
    });

    return interaction.editReply({ embeds: [emb] });
  },
};
