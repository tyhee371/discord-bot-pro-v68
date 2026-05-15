const { readSettings, putGuildSettings } = require('../../utils/settings');

// Guard: validate readSettings resolved correctly (spec 1.1)
if (typeof readSettings !== 'function') {
  throw new Error('[ticketPanelList.js] readSettings is not defined - check settings.js exports');
}

module.exports = {
  id: 'ticketPanelList',
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const [, action] = interaction.customId.split(':'); // ticketPanelList:edit|remove
    const builderId = interaction.fields.getTextInputValue('builder_id')?.trim();
    const indexRaw = interaction.fields.getTextInputValue('index')?.trim();
    const idx = Number(indexRaw) - 1;

    if (!builderId || !Number.isInteger(idx) || idx < 0) {
      return interaction.editReply({ content: '❌ Invalid builder ID or index.' });
    }

    const settings = await readSettings(interaction.guildId);
    const builders = settings?.tickets?.builders || {};
    const builder = builders[builderId];
    if (!builder) return interaction.editReply({ content: `❌ Builder \`${builderId}\` not found.` });

    const opts = Array.isArray(builder.options) ? [...builder.options] : [];
    if (idx >= opts.length) return interaction.editReply({ content: `❌ Index out of range. Builder \`${builderId}\` has ${opts.length} option(s).` });

    if (action === 'remove') {
      const removed = opts.splice(idx, 1)[0];
      // Use putGuildSettings to ensure deletion persists (deepMerge cannot remove array items)
      const nextSettings = JSON.parse(JSON.stringify(settings));
      nextSettings.tickets.builders[builderId].options = opts;
      await putGuildSettings(interaction.guildId, nextSettings);
      return interaction.editReply({ content: `✅ Removed option **${removed?.label || '(no label)'}** from builder \`${builderId}\`.` });
    }

    // edit — only fields present in the modal (edit action has extra fields)
    const label = interaction.fields.getTextInputValue('label')?.trim().slice(0, 100);
    const description = interaction.fields.getTextInputValue('description')?.trim().slice(0, 100);
    const value = interaction.fields.getTextInputValue('value')?.trim().slice(0, 100);
    const emoji = interaction.fields.getTextInputValue('emoji')?.trim();

    if (label) opts[idx].label = label;
    if (description !== undefined) opts[idx].description = description;
    if (value) opts[idx].value = value;
    // Empty string means "clear emoji"; undefined/null means "keep existing"
    if (emoji !== undefined) {
      if (emoji === '') {
        delete opts[idx].emoji;
      } else {
        opts[idx].emoji = emoji;
      }
    }

    const nextSettings = JSON.parse(JSON.stringify(settings));
    nextSettings.tickets.builders[builderId].options = opts;
    await putGuildSettings(interaction.guildId, nextSettings);

    return interaction.editReply({ content: `✅ Updated option #${idx + 1} in builder \`${builderId}\`.` });
  },
};
