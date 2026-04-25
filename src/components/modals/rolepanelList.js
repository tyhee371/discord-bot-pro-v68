const { readSettings, putGuildSettings } = require('../../utils/settings');

// Guard: validate readSettings resolved correctly (spec 1.1)
if (typeof readSettings !== 'function') {
  throw new Error('[rolepanelList.js] readSettings is not defined - check settings.js exports');
}

function getBuilders(settings) {
  const b = settings?.rolePanel?.builders;
  return (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
}

module.exports = {
  id: 'rolepanelList',
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const [, action] = interaction.customId.split(':'); // rolepanelList:edit|remove
    const builderId = interaction.fields.getTextInputValue('builder_id')?.trim();
    const indexRaw  = interaction.fields.getTextInputValue('index')?.trim();
    const idx = Number(indexRaw) - 1;

    if (!builderId || !Number.isInteger(idx) || idx < 0) {
      return interaction.editReply({ content: '\u274c Invalid builder ID or index.' });
    }

    const settings = await readSettings(interaction.guildId);
    const builders = getBuilders(settings);
    const builder = builders[builderId];
    if (!builder) return interaction.editReply({ content: `\u274c Builder \`${builderId}\` not found.` });

    const opts = Array.isArray(builder.options) ? [...builder.options] : [];
    if (idx >= opts.length) return interaction.editReply({ content: `\u274c Index out of range. Builder \`${builderId}\` has ${opts.length} option(s).` });

    if (action === 'remove') {
      const removed = opts.splice(idx, 1)[0];
      const nextSettings = JSON.parse(JSON.stringify(settings));
      nextSettings.rolePanel.builders[builderId].options = opts;
      await putGuildSettings(interaction.guildId, nextSettings);
      return interaction.editReply({ content: `\u2705 Removed option **${removed?.label || '(no label)'}** (<@&${removed?.roleId}>) from builder \`${builderId}\`.` });
    }

    // edit
    const label = interaction.fields.getTextInputValue('label')?.trim().slice(0, 100);
    const description = interaction.fields.getTextInputValue('description')?.trim().slice(0, 100);

    if (label) opts[idx].label = label;
    if (description !== undefined && description !== '') opts[idx].description = description;

    const nextSettings = JSON.parse(JSON.stringify(settings));
    nextSettings.rolePanel.builders[builderId].options = opts;
    await putGuildSettings(interaction.guildId, nextSettings);
    return interaction.editReply({ content: `\u2705 Updated option #${idx + 1} in builder \`${builderId}\`.` });
  },
};
