const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');

const { getGuildSettings, setGuildSettings } = require('../../utils/settings');
const { replyOrEdit } = require('../../utils/reply');

function slugify(input) {
  return String(input)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50) || 'ticket';
}

function uniqueValue(base, existingValues) {
  const used = new Set(existingValues);
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function generateBuilderId(existingIds, requested) {
  const cleaned = requested ? slugify(requested) : '';
  const base = cleaned || 'panel';
  return uniqueValue(base, existingIds);
}

function getBuildersFromSettings(settings) {
  const builders = settings?.tickets?.builders;
  if (builders && typeof builders === 'object' && !Array.isArray(builders)) return builders;
  return {};
}

/**
 * One-time migration: if legacy settings.tickets.panel exists and there are no builders yet,
 * convert legacy panel embed/options into a default builder.
 */
async function migrateLegacyPanelToBuilders(guildId, settings) {
  const existing = getBuildersFromSettings(settings);
  if (Object.keys(existing).length) return { settings, builders: existing };

  const legacyPanel = settings?.tickets?.panel ?? null;
  const legacyOptions = Array.isArray(legacyPanel?.options) ? legacyPanel.options : [];
  const legacyEmbed = legacyPanel?.embed ?? null;

  if (!legacyPanel && !legacyOptions.length && !legacyEmbed) {
    return { settings, builders: existing };
  }

  const builders = {
    default: {
      id: 'default',
      name: legacyEmbed?.title || legacyPanel?.title || 'Support Tickets',
      embed: legacyEmbed || {},
      options: legacyOptions,
      sent: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  };

  await setGuildSettings(guildId, { tickets: { builders } });
  const nextSettings = await getGuildSettings(guildId);
  return { settings: nextSettings, builders: getBuildersFromSettings(nextSettings) };
}

function buildPanelEmbed(builder, legacyPanelFallback) {
  const embedCfg = builder?.embed ?? legacyPanelFallback?.embed ?? {};
  const titleFallback = builder?.name || embedCfg.title || legacyPanelFallback?.title || 'Support Tickets';
  const descFallback = embedCfg.description || legacyPanelFallback?.description || 'Choose a ticket type:';

  const e = new EmbedBuilder()
    .setTitle(titleFallback)
    .setDescription(descFallback);

  if (embedCfg.color != null) e.setColor(embedCfg.color);
  if (embedCfg.thumbnailUrl) e.setThumbnail(embedCfg.thumbnailUrl);
  if (embedCfg.imageUrl) e.setImage(embedCfg.imageUrl);
  if (embedCfg.footerText) e.setFooter({ text: embedCfg.footerText });
  if (embedCfg.timestamp) e.setTimestamp();

  return e;
}

function buildSelectRow(builderId, options) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ticketv2:select:${builderId}`)
    .setPlaceholder('Select a ticket type')
    .addOptions(options.map(o => ({
      label: o.label,
      description: o.description?.slice(0, 100) || undefined,
      value: o.value,
    })));

  return new ActionRowBuilder().addComponents(menu);
}

function pickBuilder(builders, builderIdMaybe) {
  const ids = Object.keys(builders);
  if (!ids.length) return { builder: null, builderId: null, error: 'No ticket panel builders yet. Use `/ticket panel-builder` first.' };

  if (builderIdMaybe) {
    const id = slugify(builderIdMaybe);
    const b = builders[id];
    if (!b) {
      return { builder: null, builderId: null, error: `Unknown builder id \`${id}\`. Use \`/ticket builder-list\` to see builder ids.` };
    }
    return { builder: b, builderId: id, error: null };
  }

  if (ids.length === 1) return { builder: builders[ids[0]], builderId: ids[0], error: null };

  return { builder: null, builderId: null, error: `Multiple builders exist (${ids.map(x => `\`${x}\``).join(', ')}). Please provide the builder id.` };
}

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket system (dropdown V2).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(s =>
      s.setName('setup')
        .setDescription('Setup ticket roles and claim settings.')
        .addRoleOption(o => o.setName('admin_role').setDescription('Admin role (can view tickets)').setRequired(true))
        .addRoleOption(o => o.setName('mod_role').setDescription('Mod/Support role (can view tickets)').setRequired(true))
        .addIntegerOption(o => o.setName('claim_timeout_seconds').setDescription('Seconds before pinging another staff (default 60)').setRequired(false))
        .addChannelOption(o => o.setName('transcript_channel').setDescription('Optional transcript log channel').addChannelTypes(ChannelType.GuildText).setRequired(false))
    )

    // Create a builder (supports multiple builders)
    .addSubcommand(s =>
      s.setName('panel-builder')
        .setDescription('Create a new ticket panel builder (supports multiple builders).')
        .addStringOption(o => o.setName('builder_id').setDescription('Optional builder id (auto if omitted).').setRequired(false))
    )

    .addSubcommand(s =>
      s.setName('builder-list')
        .setDescription('List ticket panel builders for this server.')
    )

    .addSubcommand(s =>
      s.setName('builder-resend')
        .setDescription('Update an existing ticket panel message with the current builder config.')
        .addStringOption(o => o.setName('builder_id').setDescription('Builder id to resend').setRequired(false))
        .addStringOption(o => o.setName('message_id').setDescription('Message ID of the panel to update').setRequired(false))
        .addChannelOption(o => o.setName('channel').setDescription('Channel containing the panel message').addChannelTypes(ChannelType.GuildText).setRequired(false))
    )

    // Panel options
    .addSubcommand(s =>
      s.setName('panel-add')
        .setDescription('Add a ticket type option to a builder.')
        .addStringOption(o => o.setName('label').setDescription('Option label (e.g., Support)').setRequired(true))
        // NOTE: Discord requires all REQUIRED options to be defined before any non-required options.
        .addStringOption(o => o.setName('builder_id').setDescription('Builder id (required if multiple builders exist).').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('Option description').setRequired(false))
        .addStringOption(o => o.setName('value').setDescription('Optional value/id (auto if omitted).').setRequired(false))
    )
    .addSubcommand(s =>
      s.setName('panel-remove')
        .setDescription('Remove a ticket type option by index.')
        .addIntegerOption(o => o.setName('index').setDescription('Index from /ticket panel-list (within the builder)').setRequired(true))
        // NOTE: required options must come first.
        .addStringOption(o => o.setName('builder_id').setDescription('Builder id (required if multiple builders exist).').setRequired(false))
    )
    .addSubcommand(s =>
      s.setName('panel-list')
        .setDescription('List ticket dropdown options (grouped by builder).')
    )
    .addSubcommand(s =>
      s.setName('panel-send')
        .setDescription('Send a ticket dropdown panel for a builder to a channel.')
        .addChannelOption(o => o.setName('channel').setDescription('Channel to send panel in').setRequired(true).addChannelTypes(ChannelType.GuildText))
        // NOTE: required options must come first.
        .addStringOption(o => o.setName('builder_id').setDescription('Builder id (required if multiple builders exist).').setRequired(false))
        .addStringOption(o => o.setName('message_id').setDescription('Optional: update an existing panel message by ID instead of sending a new one.').setRequired(false))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'setup') {
      const adminRole = interaction.options.getRole('admin_role');
      const modRole = interaction.options.getRole('mod_role');
      const claimTimeout = interaction.options.getInteger('claim_timeout_seconds') ?? 60;
      const transcriptChannel = interaction.options.getChannel('transcript_channel');

      await setGuildSettings(guildId, {
        tickets: {
          adminRoleId: adminRole.id,
          modRoleId: modRole.id,
          claimTimeoutSeconds: claimTimeout,
          transcriptChannelId: transcriptChannel?.id ?? null,
        },
      });

      return replyOrEdit(interaction, {
        content: `✅ Ticket system configured.\nAdmin role: <@&${adminRole.id}>\nMod role: <@&${modRole.id}>\nClaim timeout: ${claimTimeout}s`,
        ephemeral: true,
      });
    }

    // Ensure legacy panel is migrated if present
    let settings = await getGuildSettings(guildId);
    const legacyPanel = settings?.tickets?.panel ?? {};
    const mig = await migrateLegacyPanelToBuilders(guildId, settings);
    settings = mig.settings;
    let builders = mig.builders;

    if (sub === 'panel-builder') {
      const requested = interaction.options.getString('builder_id');
      const existingIds = Object.keys(builders);
      const builderId = generateBuilderId(existingIds, requested);
      const now = Date.now();

      const builder = {
        id: builderId,
        name: 'Support Tickets',
        embed: {},
        options: [],
        sent: [],
        createdAt: now,
        updatedAt: now,
      };

      builders = { ...builders, [builderId]: builder };
      await setGuildSettings(guildId, { tickets: { builders } });

      // Post a message so the button can open the modal and the modal can edit this preview message
      const preview = buildPanelEmbed(builder, legacyPanel);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ticketPanel:edit:${builderId}`).setLabel('Edit Panel Embed').setStyle(ButtonStyle.Primary),
      );

      const msg = await interaction.channel.send({ embeds: [preview], components: [row] });
      return replyOrEdit(interaction, { content: `✅ Created builder \`${builderId}\` and posted preview: ${msg.url}`, ephemeral: true });
    }

    if (sub === 'builder-list') {
      const ids = Object.keys(builders);
      if (!ids.length) {
        return replyOrEdit(interaction, { content: 'No builders yet. Use `/ticket panel-builder` to create one.', ephemeral: true });
      }

      const lines = ids
        .sort()
        .map((id) => {
          const b = builders[id];
          const sentCount = Array.isArray(b.sent) ? b.sent.length : 0;
          const optCount = Array.isArray(b.options) ? b.options.length : 0;
          return `• **${id}** — options: **${optCount}** — panels sent: **${sentCount}**`;
        });

      const embed = new EmbedBuilder()
        .setTitle('Ticket Builders')
        .setDescription(lines.join('\n'));

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticketBuilderList:preview').setLabel('Preview').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('ticketBuilderList:edit').setLabel('Edit').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ticketBuilderList:remove').setLabel('Remove').setStyle(ButtonStyle.Danger),
      );

      return replyOrEdit(interaction, { embeds: [embed], components: [row], ephemeral: true });
    }

    if (sub === 'builder-resend') {
      const builderIdOpt = interaction.options.getString('builder_id');
      const messageIdOpt = interaction.options.getString('message_id');
      const channelOpt   = interaction.options.getChannel('channel');

      const { builder, builderId, error } = pickBuilder(builders, builderIdOpt);
      if (error) return replyOrEdit(interaction, { content: `❌ ${error}`, ephemeral: true });

      const options = Array.isArray(builder.options) ? builder.options : [];
      if (!options.length) {
        return replyOrEdit(interaction, { content: `❌ Builder \`${builderId}\` has no options yet. Use \`/ticket panel-add\` first.`, ephemeral: true });
      }

      // Try to find the panel message from stored sent list or from provided args
      const sent = Array.isArray(builder.sent) ? builder.sent : [];
      let targetChannelId = channelOpt?.id ?? null;
      let targetMessageId = messageIdOpt ?? null;

      if (!targetMessageId && sent.length > 0) {
        const last = sent[sent.length - 1];
        targetChannelId = targetChannelId ?? last.channelId;
        targetMessageId = last.messageId;
      }

      if (!targetMessageId) {
        return replyOrEdit(interaction, {
          content: `❌ No stored panel message for builder \`${builderId}\`. Provide a \`message_id\` or use \`/ticket panel-send\` to send a new one.`,
          ephemeral: true,
        });
      }

      const targetChannel = channelOpt ?? (targetChannelId ? interaction.guild.channels.cache.get(targetChannelId) : null);
      if (!targetChannel) {
        return replyOrEdit(interaction, { content: '❌ Could not find the panel channel. Provide a `channel` option.', ephemeral: true });
      }

      const existing = await targetChannel.messages.fetch(targetMessageId).catch(() => null);
      if (!existing) {
        return replyOrEdit(interaction, {
          content: `❌ Could not find message \`${targetMessageId}\` in ${targetChannel}. The message may have been deleted.`,
          ephemeral: true,
        });
      }

      const embed = buildPanelEmbed(builder, legacyPanel);
      const row   = buildSelectRow(builderId, options);
      await existing.edit({ embeds: [embed], components: [row] });

      // Update the stored sent entry timestamp
      const nextSent = sent.map(s => s.messageId === targetMessageId ? { ...s, sentAt: Date.now() } : s);
      const nextBuilder = { ...builder, sent: nextSent, updatedAt: Date.now() };
      builders = { ...builders, [builderId]: nextBuilder };
      await setGuildSettings(guildId, { tickets: { builders } });

      return replyOrEdit(interaction, { content: `✅ Panel for builder \`${builderId}\` updated in ${targetChannel}.`, ephemeral: true });
    }

    if (sub === 'panel-add') {
      const builderIdOpt = interaction.options.getString('builder_id');
      const { builder, builderId, error } = pickBuilder(builders, builderIdOpt);
      if (error) return replyOrEdit(interaction, { content: `❌ ${error}`, ephemeral: true });

      const label = interaction.options.getString('label', true).trim().slice(0, 100);
      const description = (interaction.options.getString('description') || '').trim().slice(0, 100);
      const valueIn = (interaction.options.getString('value') || '').trim();

      const existingValues = (Array.isArray(builder.options) ? builder.options : []).map(o => o.value);
      const base = valueIn ? slugify(valueIn) : slugify(label);

      // Namespace values per builder to prevent cross-builder collisions
      const namespacedBase = `${builderId}__${base}`;
      const value = uniqueValue(namespacedBase, existingValues);

      const nextOptions = [...(builder.options || []), { label, description, value }];
      const nextBuilder = { ...builder, options: nextOptions, updatedAt: Date.now() };
      builders = { ...builders, [builderId]: nextBuilder };

      await setGuildSettings(guildId, { tickets: { builders } });
      return replyOrEdit(interaction, { content: `✅ Added option **${label}** to builder \`${builderId}\` (value: \`${value}\`).`, ephemeral: true });
    }

    if (sub === 'panel-remove') {
      const builderIdOpt = interaction.options.getString('builder_id');
      const { builder, builderId, error } = pickBuilder(builders, builderIdOpt);
      if (error) return replyOrEdit(interaction, { content: `❌ ${error}`, ephemeral: true });

      const options = Array.isArray(builder.options) ? builder.options : [];
      const index = interaction.options.getInteger('index', true);
      if (index < 1 || index > options.length) {
        return replyOrEdit(interaction, { content: `❌ Invalid index for builder \`${builderId}\`. Use /ticket panel-list.`, ephemeral: true });
      }

      const removed = options[index - 1];
      const nextOptions = options.filter((_, i) => i !== index - 1);
      const nextBuilder = { ...builder, options: nextOptions, updatedAt: Date.now() };
      builders = { ...builders, [builderId]: nextBuilder };

      await setGuildSettings(guildId, { tickets: { builders } });
      return replyOrEdit(interaction, { content: `✅ Removed option **${removed.label}** from builder \`${builderId}\`.`, ephemeral: true });
    }

    if (sub === 'panel-list') {
      const ids = Object.keys(builders);
      if (!ids.length) {
        return replyOrEdit(interaction, { content: 'No builders yet.', ephemeral: true });
      }

      const chunks = [];
      for (const id of ids.sort()) {
        const b = builders[id];
        const opts = Array.isArray(b.options) ? b.options : [];
        const lines = opts.length
          ? opts.map((o, idx) => {
              const bits = [`\`${idx + 1}\` • **${o.label || '(no label)'}**`];
              if (o.description) bits.push(`— ${o.description}`);
              if (o.value) bits.push(`— value: \`${o.value}\``);
              return bits.join(' ');
            })
          : ['(no options yet)'];
        chunks.push(`### Builder: \`${id}\`\n` + lines.join('\n'));
      }

      const desc = chunks.join('\n\n').slice(0, 3800);
      const embed = new EmbedBuilder().setTitle('Ticket Panel Options').setDescription(desc);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticketPanelList:edit').setLabel('Edit Option').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ticketPanelList:remove').setLabel('Remove Option').setStyle(ButtonStyle.Danger),
      );

      return replyOrEdit(interaction, { embeds: [embed], components: [row], ephemeral: true });
    }

    if (sub === 'panel-send') {
      const builderIdOpt = interaction.options.getString('builder_id');
      const { builder, builderId, error } = pickBuilder(builders, builderIdOpt);
      if (error) return replyOrEdit(interaction, { content: `❌ ${error}`, ephemeral: true });

      const channel = interaction.options.getChannel('channel', true);
      const messageId = interaction.options.getString('message_id');
      const options = Array.isArray(builder.options) ? builder.options : [];
      if (!options.length) return replyOrEdit(interaction, { content: `❌ Builder \`${builderId}\` has no ticket options. Use \`/ticket panel-add\` first.`, ephemeral: true });

      const embed = buildPanelEmbed(builder, legacyPanel);
      const row = buildSelectRow(builderId, options);

      let msg = null;

      if (messageId) {
        // Update an existing message in that channel
        const existing = await channel.messages.fetch(messageId).catch(() => null);
        if (!existing) {
          return replyOrEdit(interaction, {
            content: `❌ I couldn't find message \`${messageId}\` in ${channel}. Make sure the message exists and I can read message history.`,
            ephemeral: true,
          });
        }

        msg = await existing.edit({ embeds: [embed], components: [row] }).catch(() => null);
        if (!msg) {
          return replyOrEdit(interaction, { content: `❌ Failed to update that message (missing perms?).`, ephemeral: true });
        }
      } else {
        // Send a new panel message
        msg = await channel.send({ embeds: [embed], components: [row] });
      }

      // Track where panels were sent/updated (for builder-list)
      const sent = Array.isArray(builder.sent) ? builder.sent : [];
      const nextSent = sent.filter(s => s.messageId !== msg.id);
      nextSent.push({ channelId: channel.id, messageId: msg.id, url: msg.url, sentAt: Date.now() });

      const nextBuilder = {
        ...builder,
        sent: nextSent,
        updatedAt: Date.now(),
      };
      builders = { ...builders, [builderId]: nextBuilder };
      await setGuildSettings(guildId, { tickets: { builders } });

      if (messageId) {
        return replyOrEdit(interaction, { content: `✅ Ticket panel (\`${builderId}\`) updated in ${channel}.`, ephemeral: true });
      }
      return replyOrEdit(interaction, { content: `✅ Ticket panel (\`${builderId}\`) sent to ${channel}.`, ephemeral: true });
    }

    return replyOrEdit(interaction, { content: 'Unknown subcommand.', ephemeral: true });
  },
};
