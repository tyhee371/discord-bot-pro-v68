const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const { getPrefix } = require('../../utils/prefixStore');
const {
  buildAllHelpEmbeds,
  buildHelpManifest,
  buildHelpCategoryOptions,
} = require('../../utils/helpBuilder');
const { privacyPolicyUrl, termsUrl } = require('../../config');

function normalizeUrl(url) {
  const v = (url || '').trim();
  return v.length ? v : null;
}

function buildHelpNoticeEmbed({ dmOk, userId }) {
  const privacy = normalizeUrl(privacyPolicyUrl);
  const terms = normalizeUrl(termsUrl);

  const lines = [
    `This message is visible only to you.`,
    `• DMs sent: ${dmOk ? '✅' : '❌ (DMs are disabled or blocked)'}`,
    `• Privacy Policy: ${privacy ? `[Click here](${privacy})` : 'Not set'}`,
    `• Terms & Conditions: ${terms ? `[Click here](${terms})` : 'Not set'}`,
  ];

  return new EmbedBuilder()
    .setTitle('Cloudy • Help')
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Requested by ${userId}` });
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

function buildHelpIntroEmbed(userId) {
  return new EmbedBuilder()
    .setTitle('Cloudy • Help')
    .setDescription(
      'Select a category to browse available commands. After choosing a category, you can select a specific command to see usage details.',
    )
    .setFooter({ text: `Requested by ${userId}` });
}

function buildHelpCategorySelect(manifest, selectedCategory) {
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

function buildHelpCommandSelect(manifest, categoryKey, selectedCommand) {
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
      label: [...group.triggers].sort().join(' / '),
      description: group.description,
      value: `${categoryKey}:${group.commandKey}`,
      default: group.commandKey === selectedCommand,
    }))
    .slice(0, 25);

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`help:command`)
      .setPlaceholder('Choose a command for details')
      .setOptions(options),
  );
}

function buildHelpComponents(manifest, selectedCategory, selectedCommand) {
  const rows = [buildHelpCategorySelect(manifest, selectedCategory)];
  if (selectedCategory) {
    rows.push(buildHelpCommandSelect(manifest, selectedCategory, selectedCommand));
  }
  return rows;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Browse the help menu interactively.'),

  buildHelpNoticeEmbed,
  buildHelpLinkButtons,
  buildHelpIntroEmbed,
  buildHelpComponents,
  buildHelpManifest,
  buildAllHelpEmbeds,

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const prefix = await getPrefix(interaction.guildId);
    const manifest = buildHelpManifest({
      client: interaction.client,
      prefix,
      member: interaction.member,
      userId: interaction.user.id,
    });

    if (!manifest.length) {
      const embed = new EmbedBuilder()
        .setTitle('Help')
        .setDescription('No commands are available for your role.')
        .setFooter({ text: `Requested by ${interaction.user.id}` });

      return interaction.editReply({
        embeds: [embed],
        components: buildHelpLinkButtons(),
      }).catch(() => {});
    }

    const introEmbed = new EmbedBuilder()
      .setTitle('Cloudy • Help')
      .setDescription(
        'Select a category to browse available commands. After choosing a category, you can select a specific command to see usage details.',
      )
      .setFooter({ text: `Requested by ${interaction.user.id}` });

    const components = [
      ...buildHelpComponents(manifest),
      ...buildHelpLinkButtons(),
    ];

    return interaction.editReply({ embeds: [introEmbed], components }).catch(() => {});
  },
};
