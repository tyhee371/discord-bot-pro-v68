const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');

const { getGuildSettings, setGuildSettings, putGuildSettings } = require('../../utils/settings');
const { safeReply } = require('../../utils/safeReply');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function replyOrEdit(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    const { flags, ephemeral, ...rest } = payload || {};
    return interaction.editReply(rest);
  }
  return safeReply(interaction, { ...payload, ephemeral: true });
}

function slugify(input) {
  return String(input)
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 50) || 'panel';
}

function uniqueId(base, existingIds) {
  const used = new Set(existingIds);
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

function getBuilders(settings) {
  const b = settings?.rolePanel?.builders;
  return (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
}

async function migrateLegacy(guildId, settings) {
  const existing = getBuilders(settings);
  if (Object.keys(existing).length) return { settings, builders: existing };

  const legacy = settings?.rolePanel?.panel ?? null;
  const legacyOptions = Array.isArray(legacy?.options) ? legacy.options : [];
  const legacyEmbed = legacy?.embed ?? null;

  if (!legacy && !legacyOptions.length && !legacyEmbed) return { settings, builders: existing };

  const builders = {
    default: {
      id: 'default',
      name: legacyEmbed?.title || 'Pick Your Roles',
      embed: legacyEmbed || {},
      options: legacyOptions,
      sent: (legacy?.lastMessageId)
        ? [{ channelId: legacy.lastChannelId, messageId: legacy.lastMessageId, sentAt: Date.now() }]
        : [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  };

  await setGuildSettings(guildId, { rolePanel: { builders } });
  const next = await getGuildSettings(guildId);
  return { settings: next, builders: getBuilders(next) };
}

function pickBuilder(builders, builderIdMaybe) {
  const ids = Object.keys(builders);
  if (!ids.length) return { builder: null, builderId: null, error: 'No builders yet. Use `/rolepanel panel-builder` first.' };
  if (builderIdMaybe) {
    const id = slugify(builderIdMaybe);
    const b = builders[id];
    if (!b) return { builder: null, builderId: null, error: `Unknown builder id \`${id}\`. Use \`/rolepanel builder-list\`.` };
    return { builder: b, builderId: id, error: null };
  }
  if (ids.length === 1) return { builder: builders[ids[0]], builderId: ids[0], error: null };
  return { builder: null, builderId: null, error: `Multiple builders (${ids.map(x => `\`${x}\``).join(', ')}). Provide a builder_id.` };
}

// ─── Embed / Select builders ─────────────────────────────────────────────────

function buildPanelEmbed(builder) {
  const cfg = builder?.embed ?? {};
  const embed = new EmbedBuilder();
  if (cfg.title) embed.setTitle(cfg.title.slice(0, 256));
  if (cfg.description) embed.setDescription(cfg.description.slice(0, 4096));
  if (cfg.color != null) { try { embed.setColor(cfg.color); } catch {} }
  if (cfg.thumbnailUrl) embed.setThumbnail(cfg.thumbnailUrl);
  if (cfg.imageUrl) embed.setImage(cfg.imageUrl);
  if (cfg.footerText) embed.setFooter({ text: cfg.footerText.slice(0, 2048) });
  if (cfg.timestamp) embed.setTimestamp(new Date());

  const options = Array.isArray(builder?.options) ? builder.options : [];
  if (options.length) {
    embed.addFields({
      name: 'Pickable Roles',
      value: options.slice(0, 40).map(o => `\u2022 <@&${o.roleId}>${o.description ? ` \u2014 ${o.description}` : ''}`).join('\n'),
    });
  } else {
    embed.addFields({ name: 'Pickable Roles', value: 'No roles configured yet.' });
  }

  if (!embed.data.title) embed.setTitle(builder?.name || 'Pick Your Roles');
  if (!embed.data.description) embed.setDescription('Select one or more roles from the menu below.');
  return embed;
}

function buildSelectRow(builderId, options, disabled = false) {
  const validOpts = options.slice(0, 25).map(o => ({
    label: String(o.label || 'Role').slice(0, 100),
    description: (o.description || '').slice(0, 100) || undefined,
    value: String(o.roleId).slice(0, 100),
  })).filter(o => o.label && o.value);

  if (!validOpts.length) { validOpts.push({ label: 'No roles yet', value: 'noop' }); disabled = true; }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`rolepanel:select:${builderId}`)
    .setPlaceholder('Select your roles\u2026')
    .setMinValues(0)
    .setMaxValues(Math.max(1, Math.min(25, validOpts.length)))
    .setDisabled(disabled)
    .addOptions(validOpts);

  return new ActionRowBuilder().addComponents(menu);
}

// ─── Command ──────────────────────────────────────────────────────────────────

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('rolepanel')
    .setDescription('Self-assign role panels (mod/admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)

    .addSubcommand(s =>
      s.setName('panel-builder')
        .setDescription('Create a new role panel builder.')
        .addStringOption(o => o.setName('builder_id').setDescription('Optional builder id (auto if omitted).').setRequired(false))
    )
    .addSubcommand(s =>
      s.setName('builder-list')
        .setDescription('List all role panel builders with Preview / Edit / Remove buttons.')
    )
    .addSubcommand(s =>
      s.setName('add')
        .setDescription('Add one or more pickable role options to a builder.')
        .addRoleOption(o => o.setName('role').setDescription('Single role to add').setRequired(false))
        .addStringOption(o => o.setName('roles').setDescription('Multiple roles: mentions/IDs separated by spaces or commas').setRequired(false))
        .addStringOption(o => o.setName('builder_id').setDescription('Builder id (required if multiple exist)').setRequired(false))
        .addStringOption(o => o.setName('label').setDescription('Label for the single role').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('Description for the single role').setRequired(false))
    )
    .addSubcommand(s =>
      s.setName('list')
        .setDescription('List role options in a builder with Edit / Remove buttons.')
        .addStringOption(o => o.setName('builder_id').setDescription('Builder id (required if multiple exist)').setRequired(false))
    )
    .addSubcommand(s =>
      s.setName('send')
        .setDescription('Send the role panel to a channel.')
        .addChannelOption(o =>
          o.setName('channel').setDescription('Channel to send the panel into')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)
        )
        .addStringOption(o => o.setName('builder_id').setDescription('Builder id (required if multiple exist)').setRequired(false))
    )
    .addSubcommand(s =>
      s.setName('resend')
        .setDescription('Update an existing role panel message with the current builder config.')
        .addStringOption(o => o.setName('builder_id').setDescription('Builder id (required if multiple exist)').setRequired(false))
        .addStringOption(o => o.setName('message_id').setDescription('Message ID to update (uses last sent if omitted)').setRequired(false))
        .addChannelOption(o =>
          o.setName('channel').setDescription('Channel containing the panel (uses stored if omitted)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    let settings = await getGuildSettings(guildId);
    const mig = await migrateLegacy(guildId, settings);
    settings = mig.settings;
    let builders = mig.builders;

    // ── panel-builder ─────────────────────────────────────────────────────────
    if (sub === 'panel-builder') {
      const requested = interaction.options.getString('builder_id');
      const builderId = uniqueId(requested ? slugify(requested) : 'panel', Object.keys(builders));
      const now = Date.now();
      const builder = { id: builderId, name: 'Pick Your Roles', embed: {}, options: [], sent: [], createdAt: now, updatedAt: now };
      builders = { ...builders, [builderId]: builder };
      await setGuildSettings(guildId, { rolePanel: { builders } });

      const preview = buildPanelEmbed(builder);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`rolepanelPanel:edit:${builderId}`).setLabel('Edit Panel Embed').setStyle(ButtonStyle.Primary),
      );
      const msg = await interaction.channel.send({ embeds: [preview], components: [row] });
      return replyOrEdit(interaction, { content: `\u2705 Created builder \`${builderId}\` and posted preview: ${msg.url}`, ephemeral: true });
    }

    // ── builder-list ──────────────────────────────────────────────────────────
    if (sub === 'builder-list') {
      const ids = Object.keys(builders);
      if (!ids.length) return replyOrEdit(interaction, { content: 'No builders yet. Use `/rolepanel panel-builder` to create one.', ephemeral: true });

      const lines = ids.sort().map(id => {
        const b = builders[id];
        const sentCount = Array.isArray(b.sent) ? b.sent.length : 0;
        const optCount = Array.isArray(b.options) ? b.options.length : 0;
        return `\u2022 **${id}** \u2014 roles: **${optCount}** \u2014 panels sent: **${sentCount}**`;
      });

      const embed = new EmbedBuilder().setTitle('Role Panel Builders').setDescription(lines.join('\n'));
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rolepanelBuilderList:preview').setLabel('Preview').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('rolepanelBuilderList:edit').setLabel('Edit').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('rolepanelBuilderList:remove').setLabel('Remove').setStyle(ButtonStyle.Danger),
      );
      return replyOrEdit(interaction, { embeds: [embed], components: [row], ephemeral: true });
    }

    // ── add ───────────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const me = await interaction.guild.members.fetchMe().catch(() => interaction.guild.members.me);
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return replyOrEdit(interaction, { content: '\u274c I need **Manage Roles** to run this command.', ephemeral: true });
      }

      const builderIdOpt = interaction.options.getString('builder_id');
      const { builder, builderId, error } = pickBuilder(builders, builderIdOpt);
      if (error) return replyOrEdit(interaction, { content: `\u274c ${error}`, ephemeral: true });

      const singleRole = interaction.options.getRole('role');
      const rolesRaw = (interaction.options.getString('roles') || '').trim();
      const roleIds = [];
      if (singleRole) roleIds.push(singleRole.id);
      if (rolesRaw) {
        for (const t of rolesRaw.split(/[\s,\n]+/g).map(t => t.trim()).filter(Boolean)) {
          const id = t.replace(/[^0-9]/g, '');
          if (id && id.length >= 17) roleIds.push(id);
        }
      }

      const uniqueIds = [...new Set(roleIds)];
      if (!uniqueIds.length) return replyOrEdit(interaction, { content: '\u274c Provide a **role** or multiple **roles** (mentions/IDs).', ephemeral: true });

      const options = Array.isArray(builder.options) ? [...builder.options] : [];
      const existingRoleIds = new Set(options.map(o => o.roleId));
      const toProcess = uniqueIds.filter(id => !existingRoleIds.has(id));
      const maxAdd = Math.max(0, 25 - options.length);
      const limited = toProcess.slice(0, maxAdd);

      const skippedDuplicates = uniqueIds.length - toProcess.length;
      const skippedBecauseLimit = toProcess.length - limited.length;
      const added = [], skippedInvalid = [], skippedUnmanageable = [];
      const botTop = me.roles.highest;

      for (const id of limited) {
        const role = interaction.guild.roles.cache.get(id) || await interaction.guild.roles.fetch(id).catch(() => null);
        if (!role) { skippedInvalid.push(id); continue; }
        if (role.managed || role.position >= botTop.position) { skippedUnmanageable.push(role); continue; }

        const isSingleMode = Boolean(singleRole) && !rolesRaw && uniqueIds.length === 1;
        let label = role.name, description = '';
        if (isSingleMode) {
          const lOpt = interaction.options.getString('label');
          const dOpt = interaction.options.getString('description');
          if (lOpt) label = lOpt;
          if (dOpt) description = dOpt;
        }
        options.push({ roleId: role.id, label: String(label).slice(0, 100), description: String(description || '').slice(0, 100) });
        added.push(role);
      }

      builders = { ...builders, [builderId]: { ...builder, options, updatedAt: Date.now() } };
      await setGuildSettings(guildId, { rolePanel: { builders } });

      const parts = [];
      if (added.length) parts.push(`\u2705 Added **${added.length}** option(s): ${added.map(r => r.toString()).join(', ')}`);
      if (skippedDuplicates) parts.push(`\u26a0\ufe0f Skipped **${skippedDuplicates}** duplicate(s).`);
      if (skippedBecauseLimit) parts.push(`\u26a0\ufe0f Skipped **${skippedBecauseLimit}** (menu cap is 25).`);
      if (skippedInvalid.length) parts.push(`\u26a0\ufe0f Skipped **${skippedInvalid.length}** invalid role ID(s).`);
      if (skippedUnmanageable.length) parts.push(`\u26a0\ufe0f Skipped **${skippedUnmanageable.length}** unmanageable role(s).`);
      if (!parts.length) parts.push('\u26a0\ufe0f Nothing changed.');
      parts.push(`Total for \`${builderId}\`: **${options.length}/25**`);
      return replyOrEdit(interaction, { content: parts.join('\n'), ephemeral: true });
    }

    // ── list ──────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const builderIdOpt = interaction.options.getString('builder_id');
      const { builder, builderId, error } = pickBuilder(builders, builderIdOpt);
      if (error) return replyOrEdit(interaction, { content: `\u274c ${error}`, ephemeral: true });

      const options = Array.isArray(builder.options) ? builder.options : [];
      if (!options.length) return replyOrEdit(interaction, { content: `No roles in builder \`${builderId}\` yet. Use \`/rolepanel add\`.`, ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle(`Role Panel Options \u2014 \`${builderId}\``)
        .setDescription('Use the buttons below to **Edit** or **Remove** options by number.')
        .addFields({
          name: `Options (${options.length})`,
          value: options.slice(0, 50)
            .map((o, i) => `${i + 1}. <@&${o.roleId}> \u2014 **${o.label}**${o.description ? `\n   \u21b3 ${o.description}` : ''}`)
            .join('\n'),
        });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rolepanelList:edit').setLabel('Edit').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('rolepanelList:remove').setLabel('Remove').setStyle(ButtonStyle.Danger),
      );
      return replyOrEdit(interaction, { embeds: [embed], components: [row], ephemeral: true });
    }

    // ── send ──────────────────────────────────────────────────────────────────
    if (sub === 'send') {
      const builderIdOpt = interaction.options.getString('builder_id');
      const { builder, builderId, error } = pickBuilder(builders, builderIdOpt);
      if (error) return replyOrEdit(interaction, { content: `\u274c ${error}`, ephemeral: true });

      const options = Array.isArray(builder.options) ? builder.options : [];
      if (!options.length) return replyOrEdit(interaction, { content: `\u274c Builder \`${builderId}\` has no roles. Use \`/rolepanel add\` first.`, ephemeral: true });

      const channel = interaction.options.getChannel('channel', true);
      const embed = buildPanelEmbed(builder);
      const menuRow = buildSelectRow(builderId, options);
      const msg = await channel.send({ embeds: [embed], components: [menuRow] });

      const prevSent = Array.isArray(builder.sent) ? builder.sent : [];
      const nextSent = [...prevSent, { channelId: channel.id, messageId: msg.id, url: msg.url, sentAt: Date.now() }];
      builders = { ...builders, [builderId]: { ...builder, sent: nextSent, updatedAt: Date.now() } };
      await setGuildSettings(guildId, { rolePanel: { builders } });
      return replyOrEdit(interaction, { content: `\u2705 Role panel \`${builderId}\` sent to ${channel}.`, ephemeral: true });
    }

    // ── resend ────────────────────────────────────────────────────────────────
    if (sub === 'resend') {
      const builderIdOpt = interaction.options.getString('builder_id');
      const { builder, builderId, error } = pickBuilder(builders, builderIdOpt);
      if (error) return replyOrEdit(interaction, { content: `\u274c ${error}`, ephemeral: true });

      const options = Array.isArray(builder.options) ? builder.options : [];
      if (!options.length) return replyOrEdit(interaction, { content: `\u274c Builder \`${builderId}\` has no roles yet.`, ephemeral: true });

      const messageIdOpt = interaction.options.getString('message_id');
      const channelOpt = interaction.options.getChannel('channel');
      const sentList = Array.isArray(builder.sent) ? builder.sent : [];

      let targetChannelId = channelOpt?.id ?? null;
      let targetMessageId = messageIdOpt ?? null;
      if (!targetMessageId && sentList.length > 0) {
        const last = sentList[sentList.length - 1];
        targetChannelId = targetChannelId ?? last.channelId;
        targetMessageId = last.messageId;
      }

      if (!targetMessageId) {
        return replyOrEdit(interaction, {
          content: `\u274c No stored panel for builder \`${builderId}\`. Provide a \`message_id\` or use \`/rolepanel send\` first.`,
          ephemeral: true,
        });
      }

      const targetChannel = channelOpt ?? (targetChannelId ? interaction.guild.channels.cache.get(targetChannelId) : null);
      if (!targetChannel) return replyOrEdit(interaction, { content: '\u274c Could not find the panel channel. Provide a `channel` option.', ephemeral: true });

      const existing = await targetChannel.messages.fetch(targetMessageId).catch(() => null);
      if (!existing) {
        return replyOrEdit(interaction, {
          content: `\u274c Could not find message \`${targetMessageId}\` in ${targetChannel}. It may have been deleted.`,
          ephemeral: true,
        });
      }

      const embed = buildPanelEmbed(builder);
      const menuRow = buildSelectRow(builderId, options);
      await existing.edit({ embeds: [embed], components: [menuRow] });

      const nextSent = sentList.map(s => s.messageId === targetMessageId ? { ...s, sentAt: Date.now() } : s);
      builders = { ...builders, [builderId]: { ...builder, sent: nextSent, updatedAt: Date.now() } };
      await setGuildSettings(guildId, { rolePanel: { builders } });
      return replyOrEdit(interaction, { content: `\u2705 Role panel \`${builderId}\` updated in ${targetChannel}.`, ephemeral: true });
    }

    return replyOrEdit(interaction, { content: 'Unknown subcommand.', ephemeral: true });
  },
};
