const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { safeReply, safeUpdate } = require('../../utils/safeReply');
const { getPrefix } = require('../../utils/prefixStore');
const {
  buildHelpManifest,
  buildHelpCategoryOptions,
  buildHelpCategoryEmbed,
  buildHelpCommandEmbed,
} = require('../../utils/helpBuilder');
const { privacyPolicyUrl, termsUrl } = require('../../config');

function normalizeUrl(url) {
  const v = (url || '').trim();
  return v.length ? v : null;
}

function buildHelpLinkButtons() {
  const privacy = normalizeUrl(privacyPolicyUrl);
  const terms = normalizeUrl(termsUrl);
  const row = new ActionRowBuilder();

  if (privacy) {
    row.addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Privacy Policy')
        .setURL(privacy),
    );
  }

  if (terms) {
    row.addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Terms')
        .setURL(terms),
    );
  }

  return row.components.length ? [row] : [];
}

function buildCategorySelect(manifest, selectedCategory) {
  const options = buildHelpCategoryOptions(manifest).map((option) => ({
    ...option,
    default: option.value === selectedCategory,
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('help:category')
      .setPlaceholder('Choose a command category')
      .setOptions(options),
  );
}

function truncate(str, max) {
  const value = String(str ?? '');
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function buildCommandSelect(manifest, categoryKey, selectedCommand) {
  const entries = manifest.filter((entry) => entry.moduleKey === categoryKey);
  const groups = new Map();

  for (const entry of entries) {
    const commandKey = entry.commandKey || entry.trigger;
    if (!groups.has(commandKey)) {
      groups.set(commandKey, {
        commandKey,
        description: entry.description,
        triggers: new Set(),
      });
    }
    const group = groups.get(commandKey);
    group.triggers.add(entry.trigger);
  }

  const options = [...groups.values()]
    .sort((a, b) => a.commandKey.localeCompare(b.commandKey))
    .map((group) => ({
      label: truncate(group.commandKey, 100),
      description: truncate(group.description, 100),
      value: `${categoryKey}:${group.commandKey}`,
      default: group.commandKey === selectedCommand,
    }))
    .slice(0, 25);

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('help:command')
      .setPlaceholder('Choose a command for details')
      .setOptions(options),
  );
}

function buildHelpComponents(manifest, selectedCategory, selectedCommand) {
  const rows = [buildCategorySelect(manifest, selectedCategory)];
  if (selectedCategory) {
    rows.push(buildCommandSelect(manifest, selectedCategory, selectedCommand));
  }
  return rows;
}

module.exports = {
  id: 'help',
  async execute(interaction) {
    const prefix = await getPrefix(interaction.guildId);
    const manifest = buildHelpManifest({
      client: interaction.client,
      prefix,
      member: interaction.member,
      userId: interaction.user.id,
    });

    if (!manifest.length) {
      const msg = 'No help commands are available for your role.';
      if (interaction.isMessageComponent?.()) {
        try {
          await safeUpdate(interaction, { content: msg, embeds: [], components: [] });
          return;
        } catch {
          // fall through to ephemeral reply
        }
      }
      return safeReply(interaction, { ephemeral: true, content: msg });
    }

    const parts = String(interaction.customId).split(':');
    const action = parts[1];

    if (action === 'category') {
      const selectedCategory = interaction.values?.[0];
      if (!selectedCategory) {
        return safeReply(interaction, { ephemeral: true, content: 'Category selection failed. Please try again.' });
      }
      const entries = manifest.filter((entry) => entry.moduleKey === selectedCategory);
      const embed = buildHelpCategoryEmbed(selectedCategory, entries, interaction.user.id);
      const components = [
        ...buildHelpComponents(manifest, selectedCategory),
        ...buildHelpLinkButtons(),
      ];
      return safeUpdate(interaction, { content: null, embeds: [embed], components });
    }

    if (action === 'command') {
      const selectedValue = interaction.values?.[0] || '';
      const [selectedCategory, selectedCommand] = selectedValue.split(':');
      if (!selectedCategory || !selectedCommand) {
        return safeReply(interaction, { ephemeral: true, content: 'Command selection failed. Please try again.' });
      }
      const entries = manifest.filter(
        (entry) => entry.moduleKey === selectedCategory && entry.commandKey === selectedCommand,
      );
      if (!entries.length) {
        return safeReply(interaction, { ephemeral: true, content: 'That command could not be found.' });
      }
      const embed = buildHelpCommandEmbed(selectedCategory, selectedCommand, entries, interaction.user.id);
      const components = [
        ...buildHelpComponents(manifest, selectedCategory, selectedCommand),
        ...buildHelpLinkButtons(),
      ];
      return safeUpdate(interaction, { content: null, embeds: [embed], components });
    }

    // Legacy / unknown help menu interaction
    const msg = 'This help menu has been updated. Please run **/help** again to open the new interactive help menu.';
    if (interaction.isMessageComponent?.()) {
      try {
        await safeUpdate(interaction, { content: msg, embeds: [], components: [] });
        return;
      } catch {
        // fall through
      }
    }

    return safeReply(interaction, { ephemeral: true, content: msg });
  },
};
