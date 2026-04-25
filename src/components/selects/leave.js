const { getGuildSettings, setGuildSettings } = require('../../utils/settings');
const { build } = require('../../utils/leaveBuilderView');

module.exports = {
  id: 'leave',
  async execute(interaction) {
    const [, action] = interaction.customId.split(':'); // leave:channel
    if (action !== 'channel') return;

    const channelId = interaction.values?.[0];
    const settings = await getGuildSettings(interaction.guildId);
    const cfg = settings.leave ?? {};

    await setGuildSettings(interaction.guildId, { leave: { ...cfg, channelId } });
    const updated = await getGuildSettings(interaction.guildId);

    return interaction.update(build(interaction, updated));
  },
};
