const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { safeDefer } = require('../../utils/safeReply');
const { readSettings, putGuildSettings } = require('../../utils/settings');

// Guard: validate readSettings resolved correctly (spec 1.1)
if (typeof readSettings !== 'function') {
  throw new Error('[rolepanelBuilderList.js] readSettings is not defined - check settings.js exports');
}

function getBuilders(settings) {
  const b = settings?.rolePanel?.builders;
  return (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
}

function buildPreviewEmbed(builderId, builder) {
  const cfg = builder.embed || {};
  const embed = new EmbedBuilder();

  if (cfg.title) embed.setTitle(cfg.title.slice(0, 256));
  if (cfg.description) embed.setDescription(cfg.description.slice(0, 4096));
  if (cfg.color != null) { try { embed.setColor(cfg.color); } catch {} }
  if (cfg.thumbnailUrl) embed.setThumbnail(cfg.thumbnailUrl);
  if (cfg.imageUrl) embed.setImage(cfg.imageUrl);
  if (cfg.footerText) embed.setFooter({ text: cfg.footerText.slice(0, 2048) });
  if (cfg.timestamp) embed.setTimestamp(new Date());

  if (!cfg.title && !cfg.description) {
    embed.setTitle(builder.name || 'Role Panel').setDescription('Configure this builder with the **Edit** button below.');
  }

  const options = (Array.isArray(builder.options) ? builder.options : []).slice(0, 25);
  const usedVals = new Set();
  const menuOpts = options.map((o, idx) => {
    const clean = v => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim();
    const label = clean(o?.label ?? `Role ${idx + 1}`).slice(0, 100) || `Role ${idx + 1}`;
    let value = clean(o?.roleId ?? `role_${idx + 1}`).slice(0, 100) || `role_${idx + 1}`;
    if (usedVals.has(value)) value = `${value.slice(0, 95)}_${idx + 1}`;
    usedVals.add(value);
    const desc = clean(o?.description ?? '').slice(0, 100);
    const opt = { label, value };
    if (desc.length > 0) opt.description = desc;
    return opt;
  }).filter(o => o.label && o.value && o.label.length <= 100 && o.value.length <= 100);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`rolepanel:select:${builderId}`)
    .setPlaceholder('Select your roles\u2026')
    .setMinValues(0)
    .setMaxValues(Math.max(1, Math.min(25, menuOpts.length || 1)))
    .addOptions(menuOpts.length ? menuOpts : [{ label: 'No roles yet', value: 'noop' }])
    .setDisabled(!menuOpts.length);

  const menuRow = new ActionRowBuilder().addComponents(menu);
  const editRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rolepanelPanel:edit:${builderId}`)
      .setLabel('Edit Builder Embed')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embed, rows: [menuRow, editRow] };
}

module.exports = {
  id: 'rolepanelBuilderList',
  async execute(interaction) {
    await safeDefer(interaction, { ephemeral: true });

    const [, action] = interaction.customId.split(':'); // rolepanelBuilderList:preview|edit|remove
    const builderId = interaction.fields.getTextInputValue('builder_id')?.trim();
    if (!builderId) return interaction.editReply({ content: '\u274c Missing builder ID.' });

    const settings = await readSettings(interaction.guildId);
    const builders = getBuilders(settings);
    const builder = builders[builderId];

    if (!builder) {
      return interaction.editReply({ content: `\u274c Builder \`${builderId}\` not found. Use \`/rolepanel builder-list\` to see available IDs.` });
    }

    // REMOVE — must deep-clone then use putGuildSettings so deletion persists
    if (action === 'remove') {
      const next = { ...builders };
      delete next[builderId];
      const nextSettings = JSON.parse(JSON.stringify(settings));
      nextSettings.rolePanel = nextSettings.rolePanel || {};
      nextSettings.rolePanel.builders = next;
      await putGuildSettings(interaction.guildId, nextSettings);
      return interaction.editReply({ content: `\u2705 Removed role panel builder \`${builderId}\`.` });
    }

    // PREVIEW and EDIT — show embed preview + edit button
    const { embed, rows } = buildPreviewEmbed(builderId, builder);
    return interaction.editReply({ embeds: [embed], components: rows });
  },
};
