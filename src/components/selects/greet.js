const { getGuildSettings, setGuildSettings } = require('../../utils/settings');
const { build } = require('../../utils/greetBuilderView');

module.exports = {
  id: 'greet',
  async execute(interaction) {
    const [, action] = interaction.customId.split(':'); // greet:channel
    if (action !== 'channel') return;

    const channelId = interaction.values?.[0];
    const settings = await getGuildSettings(interaction.guildId);
    const cfg = settings.greet ?? {};

    await setGuildSettings(interaction.guildId, { greet: { ...cfg, channelId } });
    const updated = await getGuildSettings(interaction.guildId);

    return interaction.update(build(interaction, updated));
  },
};
