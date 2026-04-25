const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/settings');
const { isStaff } = require('../../utils/isStaff');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('prefix')
    .setDescription('View or change the bot prefix (for message commands)')
    .addSubcommand((s) => s.setName('view').setDescription('Show the current prefix'))
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Set a new prefix')
        .addStringOption((o) => o.setName('prefix').setDescription('New prefix (max 5 chars)').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('reset').setDescription('Reset prefix back to "!"'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    const settings = await getGuildSettings(interaction.guildId);
    const current = settings?.prefix ?? '!';

    if (sub === 'view') {
      return interaction.editReply(`Current prefix: \`${current}\``);
    }

    // Permission: ManageGuild OR admin/mod role IDs
    const ok = isStaff(interaction.guild, interaction.member, settings);
    if (!ok) return interaction.editReply('You do not have permission to change the prefix.');

    if (sub === 'set') {
      const next = interaction.options.getString('prefix', true).trim();
      if (!next || next.length > 5) return interaction.editReply('Prefix must be 1-5 characters.');

      await setGuildSettings(interaction.guildId, { prefix: next });
      return interaction.editReply(`✅ Prefix set to \`${next}\``);
    }

    if (sub === 'reset') {
      await setGuildSettings(interaction.guildId, { prefix: '!' });
      return interaction.editReply('✅ Prefix reset to `!`');
    }

    return interaction.editReply('Unknown subcommand.');
  },
};
