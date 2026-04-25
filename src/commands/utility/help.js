const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const { getPrefix } = require('../../utils/prefixStore');
const { buildPrefixHelpEmbeds } = require('../../utils/helpBuilder');
const { privacyPolicyUrl, termsUrl } = require('../../config');

function normalizeUrl(url) {
  const v = (url || '').trim();
  return v.length ? v : null;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildHelpNoticeEmbed({ dmOk, userId }) {
  const privacy = normalizeUrl(privacyPolicyUrl);
  const terms = normalizeUrl(termsUrl);

  const lines = [
    `This message is visible for everyone.`,
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

/**
 * Build slash command help embeds by reading registered commands from Discord.
 * Shows top-level slash commands (name + description), 10 per embed.
 */
async function buildSlashHelpEmbeds({ client, guild }) {
  try {
    const coll = guild?.commands
      ? await guild.commands.fetch()
      : await client.application?.commands.fetch();

    const cmds = coll ? [...coll.values()] : [];
    if (!cmds.length) {
      return [
        new EmbedBuilder()
          .setTitle('Slash commands')
          .setDescription('No slash commands found (or I could not fetch them).'),
      ];
    }

    const lines = cmds
      .filter((c) => c && c.name)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `• \`/${c.name}\` — ${c.description || 'No description'}`);

    return chunk(lines, 10).map((page, i, arr) =>
      new EmbedBuilder()
        .setTitle(`Slash commands (${i + 1}/${arr.length})`)
        .setDescription(page.join('\n')),
    );
  } catch {
    return [
      new EmbedBuilder()
        .setTitle('Slash commands')
        .setDescription('I could not load slash commands right now.'),
    ];
  }
}

/**
 * Build prefix command help embeds.
 */
function buildPrefixEmbeds(prefix) {
  return buildPrefixHelpEmbeds(prefix);
}

/**
 * Build ALL help embeds: slash + prefix.
 * This is used by both /help and !help.
 */
async function buildAllHelpEmbeds({ client, guild, prefix }) {
  const slashEmbeds = await buildSlashHelpEmbeds({ client, guild });
  const prefixEmbeds = buildPrefixEmbeds(prefix);
  return [...slashEmbeds, ...prefixEmbeds];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show command list (DM) + public notice with Terms/Privacy links.'),

  buildHelpNoticeEmbed,
  buildHelpLinkButtons,
  buildAllHelpEmbeds,

  async execute(interaction) {
    // Ack immediately so Discord won't leave /help "thinking..."
    await interaction.deferReply({ ephemeral: false }).catch(() => {});

    const prefix = await getPrefix(interaction.guildId);
    const allEmbeds = await buildAllHelpEmbeds({
      client: interaction.client,
      guild: interaction.guild,
      prefix,
    });

    // Discord allows max 10 embeds per message.
    const groups = chunk(allEmbeds, 10);

    let dmOk = false;
    try {
      for (const g of groups) {
        await interaction.user.send({ embeds: g });
      }
      dmOk = true;
    } catch {
      dmOk = false;
    }

    const noticeEmbed = buildHelpNoticeEmbed({ dmOk, userId: interaction.user.id });
    const components = buildHelpLinkButtons();

    // If DM failed, also show help embeds in-channel so user still gets help.
    if (!dmOk) {
      const first = groups[0] || [];
      const rest = groups.slice(1);

      await interaction.editReply({
        embeds: [noticeEmbed, ...first],
        components,
        allowedMentions: { users: [interaction.user.id] },
      }).catch(() => {});

      for (const g of rest) {
        await interaction.channel?.send({ embeds: g }).catch(() => {});
      }
      return;
    }

    // DM succeeded: only the public notice
    return interaction.editReply({
      embeds: [noticeEmbed],
      components,
      allowedMentions: { users: [interaction.user.id] },
    }).catch(() => {});
  },
};
