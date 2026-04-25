const { MessageFlags } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/settings');

module.exports = {
  id: 'rolepanelOptionEdit',

  async execute(interaction) {
    // Modal submits must be acknowledged quickly; defer to avoid "Unknown interaction" (10062)
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }

    const guildId = interaction.guildId;
    const settings = await getGuildSettings(guildId);
    const panel = settings?.rolePanel?.panel ?? {};
    const options = Array.isArray(panel.options) ? panel.options : [];

    if (!options.length) {
      return interaction.editReply({ content: 'No role options configured yet.' });
    }

    const rawIndex = (interaction.fields.getTextInputValue('index') || '').trim();
    const idx = Number(rawIndex);
    if (!Number.isInteger(idx) || idx < 1 || idx > options.length) {
      return interaction.editReply({ content: 'Invalid role number. Use **/rolepanel list** to see numbers.' });
    }

    const label = (interaction.fields.getTextInputValue('label') || '').trim();
    const description = (interaction.fields.getTextInputValue('description') || '').trim();

    const target = { ...options[idx - 1] };
    if (label) target.label = label.slice(0, 100);
    if (description) target.description = description.slice(0, 100);

    const next = options.map((o, i) => (i === idx - 1 ? target : o));
    await setGuildSettings(guildId, { rolePanel: { panel: { options: next } } });

    return interaction.editReply({
      content: `✅ Updated option **#${idx}** for <@&${target.roleId}>.`,
    });
  },
};
