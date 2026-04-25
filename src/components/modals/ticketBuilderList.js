const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { safeDefer } = require('../../utils/safeReply');
const { readSettings, putGuildSettings } = require('../../utils/settings');

// Guard: validate readSettings resolved correctly (spec 1.1)
if (typeof readSettings !== 'function') {
  throw new Error('[ticketBuilderList.js] readSettings is not defined - check settings.js exports');
}

function buildTicketPanelPreview(builderId, builder) {
  const embedCfg = builder.embed || {};
  const embed = new EmbedBuilder();

  if (embedCfg.title) embed.setTitle(embedCfg.title.slice(0, 256));
  if (embedCfg.description) embed.setDescription(embedCfg.description.slice(0, 4096));
  if (embedCfg.footerText) embed.setFooter({ text: embedCfg.footerText.slice(0, 2048) });
  if (embedCfg.imageUrl) embed.setImage(embedCfg.imageUrl);
  if (embedCfg.thumbnailUrl) embed.setThumbnail(embedCfg.thumbnailUrl);
  if (embedCfg.color != null) {
    try { embed.setColor(embedCfg.color); } catch {}
  }
  if (embedCfg.timestamp) embed.setTimestamp(new Date());

  if (!embedCfg.title && !embedCfg.description) {
    embed.setTitle('Ticket Panel').setDescription('Configure this builder with the **Edit** button below.');
  }

  // Validate options strictly per Discord limits
  const usedValues = new Set();
  const rawOptions = Array.isArray(builder.options) ? builder.options.slice(0, 25) : [];
  const options = rawOptions.map((o, idx) => {
    const fallback = `Option ${idx + 1}`;
    const clean = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim();

    const label = (clean(o?.label ?? fallback).slice(0, 100)) || fallback;

    let value = clean(o?.value ?? o?.label ?? `opt_${idx + 1}`);
    if (!value) value = `opt_${idx + 1}`;
    value = value.slice(0, 100);
    if (usedValues.has(value)) value = `${value.slice(0, 95)}_${idx + 1}`;
    usedValues.add(value);

    const description = clean(o?.description ?? '').slice(0, 100);
    const opt = { label, value };
    if (description.length > 0) opt.description = description;
    return opt;
  }).filter(o => o && o.label && o.value && o.label.length <= 100 && o.value.length <= 100);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ticketv2:select:${builderId}`)
    .setPlaceholder('Choose a ticket type…')
    .addOptions(options.length ? options : [{ label: 'No options yet', value: 'noop' }])
    .setMinValues(1)
    .setMaxValues(1);

  const row = new ActionRowBuilder().addComponents(menu);
  const editRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticketPanel:edit:${builderId}`)
      .setLabel('Edit Builder Embed')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embed, rows: [row, editRow] };
}

module.exports = {
  id: 'ticketBuilderList',
  async execute(interaction) {
    await safeDefer(interaction, { ephemeral: true });

    const [, action] = interaction.customId.split(':'); // ticketBuilderList:preview|edit|remove
    const builderId = interaction.fields.getTextInputValue('builder_id')?.trim();
    if (!builderId) return interaction.editReply({ content: '❌ Missing builder ID.' });

    const settings = await readSettings(interaction.guildId);
    const builders = settings?.tickets?.builders || {};
    const builder = builders[builderId];

    if (!builder) {
      return interaction.editReply({ content: `❌ Builder \`${builderId}\` not found. Use \`/ticket builder-list\` to see available IDs.` });
    }

    // REMOVE: must use putGuildSettings to persist deletions (deepMerge cannot remove keys)
    if (action === 'remove') {
      const next = { ...builders };
      delete next[builderId];
      const nextSettings = JSON.parse(JSON.stringify(settings));
      nextSettings.tickets = nextSettings.tickets || {};
      nextSettings.tickets.builders = next;
      await putGuildSettings(interaction.guildId, nextSettings);
      return interaction.editReply({ content: `✅ Removed ticket builder \`${builderId}\`.` });
    }

    // PREVIEW and EDIT: show the builder embed + edit button
    const { embed, rows } = buildTicketPanelPreview(builderId, builder);
    return interaction.editReply({ embeds: [embed], components: rows });
  },
};
