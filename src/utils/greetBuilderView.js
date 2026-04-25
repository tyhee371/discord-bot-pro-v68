const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
} = require('discord.js');

function boolEmoji(v) {
  return v ? '✅' : '❌';
}

function safePreview(s, max = 60) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '(empty)';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function build(interaction, settings) {
  const cfg = settings.greet ?? {};
  const e = cfg.embed ?? {};

  const embed = new EmbedBuilder()
    .setTitle('Greeting Builder')
    .setDescription(
      [
        'Configure the greeting message when someone joins your server.',
        '',
        '**Placeholders:** `{user}` `{username}` `{tag}` `{id}` `{server}` `{memberCount}` `{avatar}`',
      ].join('\n'),
    )
    .addFields(
      {
        name: 'Status',
        value:
          `Enabled: ${boolEmoji(!!cfg.enabled)}\n` +
          `Channel: ${cfg.channelId ? `<#${cfg.channelId}>` : '(not set)'}\n` +
          `DM New Users: ${boolEmoji(!!cfg.dmEnabled)}\n` +
          `Auto delete: ${cfg.autoDeleteSeconds ? `${cfg.autoDeleteSeconds}s` : 'off'}`,
      },
      {
        name: 'Message',
        value: safePreview(cfg.message ?? 'Welcome {user}!', 120),
      },
      {
        name: 'Embed',
        value:
          `Enabled: ${boolEmoji(!!e.enabled)}\n` +
          `Title: ${safePreview(e.title, 40)}\n` +
          `Description: ${safePreview(e.description, 60)}\n` +
          `Color: ${e.color ?? '(default)'}\n` +
          `Thumbnail URL: ${e.thumbnailUrl ? 'set' : 'not set'}\n` +
          `Avatar Thumb: ${boolEmoji(!!e.thumbnail)}\n` +
          `Image URL: ${e.imageUrl ? 'set' : 'not set'}\n` +
          `Footer Enabled: ${boolEmoji(e.footerEnabled !== false)}\n` +
          `Footer: ${e.footerText ? safePreview(e.footerText, 60) : 'off'}\n` +
          `Footer Icon: ${e.footerIconUrl ? 'set' : 'not set'}\n` +
          `Footer Timestamp: ${boolEmoji(!!e.footerTimestamp)}`,
      },
    );

  const channelSelect = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('greet:channel')
      .setPlaceholder('Select the greet channel')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1),
  );

  const rowToggles = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('greet:toggle_enabled')
      .setLabel(cfg.enabled ? 'Disable' : 'Enable')
      .setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('greet:toggle_embed')
      .setLabel(e.enabled ? 'Embed: On' : 'Embed: Off')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('greet:toggle_dm')
      .setLabel(cfg.dmEnabled ? 'DM: On' : 'DM: Off')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('greet:test').setLabel('Send Test').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('greet:refresh').setLabel('Refresh').setStyle(ButtonStyle.Secondary),
  );

  const rowEdit = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('greet:edit_message').setLabel('Edit Message').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('greet:edit_embed').setLabel('Edit Embed').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('greet:auto_delete').setLabel('Auto Delete').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('greet:toggle_thumb').setLabel('Toggle Avatar Thumb').setStyle(ButtonStyle.Secondary),
  );

  const rowFooter = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('greet:toggle_footer').setLabel('Toggle Footer').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('greet:edit_footer').setLabel('Edit Footer').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('greet:toggle_ts').setLabel('Toggle Timestamp').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('greet:clear_footer').setLabel('Clear Footer').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [channelSelect, rowToggles, rowEdit, rowFooter] };
}

module.exports = { build };
