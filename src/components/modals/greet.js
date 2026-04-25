const { getGuildSettings, setGuildSettings } = require('../../utils/settings');
const { build } = require('../../utils/greetBuilderView');

module.exports = {
  id: 'greet',
  async execute(interaction) {
    const [, action] = interaction.customId.split(':');
    const settings = await getGuildSettings(interaction.guildId);
    const cfg = settings.greet ?? {};
    const e = cfg.embed ?? {};

    if (action === 'modal_message') {
      const message = interaction.fields.getTextInputValue('message') ?? '';
      await setGuildSettings(interaction.guildId, { greet: { ...cfg, message } });
      const updated = await getGuildSettings(interaction.guildId);
      return interaction.update(build(interaction, updated));
    }

    if (action === 'modal_embed') {
      const title = interaction.fields.getTextInputValue('title') ?? '';
      const description = interaction.fields.getTextInputValue('description') ?? '';
      const color = interaction.fields.getTextInputValue('color') ?? '';
      // allow backward ids too
      const thumbnailUrl = (interaction.fields.getTextInputValue('thumbnailUrl') ?? interaction.fields.getTextInputValue('thumbnail_url') ?? '').trim();
      const imageUrl = (interaction.fields.getTextInputValue('imageUrl') ?? interaction.fields.getTextInputValue('image_url') ?? '').trim();

      await setGuildSettings(interaction.guildId, {
        greet: {
          ...cfg,
          embed: { ...e, title, description, color, thumbnailUrl, imageUrl },
        },
      });

      const updated = await getGuildSettings(interaction.guildId);
      return interaction.update(build(interaction, updated));
    }

    if (action === 'modal_autodel') {
      const raw = interaction.fields.getTextInputValue('seconds') ?? '0';
      const n = Math.max(0, Math.floor(Number(raw)));
      await setGuildSettings(interaction.guildId, { greet: { ...cfg, autoDeleteSeconds: n || 0 } });
      const updated = await getGuildSettings(interaction.guildId);
      return interaction.update(build(interaction, updated));
    }

    if (action === 'modal_footer') {
      const footerText = interaction.fields.getTextInputValue('footerText')?.trim() ?? '';
      const footerIconUrl = interaction.fields.getTextInputValue('footerIconUrl')?.trim() ?? '';

      const footerEnabled = !!(footerText || footerIconUrl);

      await setGuildSettings(interaction.guildId, {
        greet: {
          ...cfg,
          embed: { ...e, footerText, footerIconUrl, footerEnabled },
        },
      });

      const updated = await getGuildSettings(interaction.guildId);
      return interaction.update(build(interaction, updated));
    }

    return interaction.reply({ content: 'Unknown modal.', ephemeral: true });
  },
};
