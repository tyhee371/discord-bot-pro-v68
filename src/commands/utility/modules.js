const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getModules, setModuleEnabled } = require('../../utils/modules');
const { safeReply } = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modules')
    .setDescription('Enable/disable bot modules per server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('status').setDescription('Show module status.'))
    .addSubcommand((s) =>
      s
        .setName('enable')
        .setDescription('Enable a module.')
        .addStringOption((o) =>
          o
            .setName('module')
            .setDescription('Module name')
            .setRequired(true)
            .addChoices(
              { name: 'music', value: 'music' },
              { name: 'tickets', value: 'tickets' },
              { name: 'logs', value: 'logs' },
              { name: 'roles', value: 'roles' },
              { name: 'moderation', value: 'moderation' },
              { name: 'fun', value: 'fun' },
              { name: 'utility', value: 'utility' },
              { name: 'greet', value: 'greet' },
              { name: 'rooms', value: 'rooms' },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('disable')
        .setDescription('Disable a module.')
        .addStringOption((o) =>
          o
            .setName('module')
            .setDescription('Module name')
            .setRequired(true)
            .addChoices(
              { name: 'music', value: 'music' },
              { name: 'tickets', value: 'tickets' },
              { name: 'logs', value: 'logs' },
              { name: 'roles', value: 'roles' },
              { name: 'moderation', value: 'moderation' },
              { name: 'fun', value: 'fun' },
              { name: 'utility', value: 'utility' },
              { name: 'greet', value: 'greet' },
              { name: 'rooms', value: 'rooms' },
            ),
        ),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      const modules = await getModules(interaction.guildId);
      const emb = new EmbedBuilder()
        .setTitle('Module Status')
        .setDescription(
          Object.entries(modules)
            .map(([k, v]) => `• **${k}**: ${v ? '✅ On' : '❌ Off'}`)
            .join('\n'),
        )
        .setTimestamp();
      return safeReply(interaction, { embeds: [emb], ephemeral: true });
    }

    const moduleKey = interaction.options.getString('module', true);
    const enabled = sub === 'enable';
    await setModuleEnabled(interaction.guildId, moduleKey, enabled);
    return safeReply(interaction, { content: `✅ Module **${moduleKey}** is now **${enabled ? 'enabled' : 'disabled'}**.`, ephemeral: true });
  },
};
