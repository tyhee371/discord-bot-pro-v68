const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/settings');
const { isStaff } = require('../../utils/isStaff');
const { applyPlaceholders } = require('../../utils/placeholders');
const { build: buildGreetBuilder } = require('../../utils/greetBuilderView');

function parseColor(input) {
  if (!input) return null;
  const s = input.trim().toLowerCase();

  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
    return parseInt(hex, 16);
  }
  if (/^[0-9a-f]{6}$/i.test(s)) return parseInt(s, 16);
  if (/^\d+$/.test(s)) return Number(s);
  return null;
}

function buildEmbed(cfg, ctx) {
  if (!cfg?.embed?.enabled) return null;

  const title = applyPlaceholders(cfg.embed.title || 'Welcome!', ctx);
  const desc = applyPlaceholders(cfg.embed.description || '{user} joined {server}', ctx);

  const e = new EmbedBuilder()
    .setTitle(title.slice(0, 256))
    .setDescription(desc.slice(0, 4096));

  if (cfg.embed.color !== null && cfg.embed.color !== undefined) {
    const color = typeof cfg.embed.color === 'number' ? cfg.embed.color : parseColor(String(cfg.embed.color));
    if (color !== null) e.setColor(color);
  }

  if (cfg.embed.thumbnailUrl) e.setThumbnail(applyPlaceholders(cfg.embed.thumbnailUrl, ctx));
  else if (cfg.embed.thumbnail) e.setThumbnail(ctx.avatar);
  if (cfg.embed.imageUrl) e.setImage(applyPlaceholders(cfg.embed.imageUrl, ctx));

  const footerEnabled = cfg.embed.footerEnabled !== false;
  if (footerEnabled) {
    const footerText = applyPlaceholders(cfg.embed.footerText || '', ctx).trim();
    const footerIconUrl = applyPlaceholders(cfg.embed.footerIconUrl || '', ctx).trim();
    if (footerText || footerIconUrl) {
      e.setFooter({ text: footerText || '\u200b', ...(footerIconUrl ? { iconURL: footerIconUrl } : {}) });
    }
    if (cfg.embed.footerTimestamp) e.setTimestamp();
  }

  return e;
}

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('greet')
    .setDescription('Welcome (greet) messages.')
    .addSubcommand(s =>
      s.setName('builder')
        .setDescription('Open the greeting builder UI.')
    )
    .addSubcommand(s =>
      s.setName('set-channel')
        .setDescription('Set the greet channel.')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)),
    )
    .addSubcommand(s =>
      s.setName('set-message')
        .setDescription('Set greet message template.')
        .addStringOption(o =>
          o.setName('message')
            .setDescription('Template. Placeholders: {user} {username} {server} {memberCount}')
            .setRequired(true),
        ),
    )
    .addSubcommand(s =>
      s.setName('toggle')
        .setDescription('Enable/disable greet.')
        .addBooleanOption(o => o.setName('enabled').setDescription('On/Off').setRequired(true)),
    )
    
    .addSubcommand(s =>
      s.setName('autodelete')
        .setDescription('Auto delete greet message after N seconds (0=off).')
        .addIntegerOption(o => o.setName('seconds').setDescription('Seconds').setMinValue(0).setMaxValue(86400).setRequired(true)),
    )
    .addSubcommand(s =>
      s.setName('dm')
        .setDescription('Also send greet message to user via DM.')
        .addBooleanOption(o => o.setName('enabled').setDescription('On/Off').setRequired(true)),
    )
    .addSubcommand(s =>
      s.setName('test')
        .setDescription('Send a test greet message in the configured channel.'),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const settings = await getGuildSettings(interaction.guildId);

    // Role-ID aware staff check (tickets admin/mod roles), with ManageGuild/Administrator fallback
    if (!isStaff(interaction.guild, interaction.member, settings)) {
      return interaction.editReply('You do not have permission to use this.');
    }

    const cfg = settings.greet ?? {};
    const sub = interaction.options.getSubcommand();

    if (sub === 'builder') {
      const settings = await getGuildSettings(interaction.guildId);
      const payload = buildGreetBuilder(interaction, settings);
      return interaction.editReply(payload);
    }

    if (sub === 'set-channel') {
      const channel = interaction.options.getChannel('channel', true);
      await setGuildSettings(interaction.guildId, { greet: { ...cfg, channelId: channel.id } });
      return interaction.editReply(`✅ Greet channel set to ${channel}.`);
    }

    if (sub === 'set-message') {
      const message = interaction.options.getString('message', true);
      await setGuildSettings(interaction.guildId, { greet: { ...cfg, message } });
      return interaction.editReply(`✅ Greet message updated.`);
    }

    if (sub === 'toggle') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await setGuildSettings(interaction.guildId, { greet: { ...cfg, enabled } });
      return interaction.editReply(`✅ Greet is now **${enabled ? 'ON' : 'OFF'}**.`);
    }

    if (sub === 'autodelete') {
      const seconds = interaction.options.getInteger('seconds', true);
      await setGuildSettings(interaction.guildId, { greet: { ...cfg, autoDeleteSeconds: seconds } });
      return interaction.editReply(`✅ Auto-delete set to ${seconds}s.`);
    }

    if (sub === 'dm') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await setGuildSettings(interaction.guildId, { greet: { ...cfg, dmEnabled: enabled } });
      return interaction.editReply(`✅ DM greet is now **${enabled ? 'ON' : 'OFF'}**.`);
    }

    if (sub === 'test') {
      const settings = await getGuildSettings(interaction.guildId);
      const cfg = settings.greet;

      if (!cfg?.channelId) return interaction.editReply('Set a greet channel first: `/greet set-channel`.');

      const channel = await interaction.guild.channels.fetch(cfg.channelId).catch(() => null);
      if (!channel) return interaction.editReply('Configured greet channel no longer exists.');

      const ctx = {
        userMention: interaction.user.toString(),
        username: interaction.user.username,
        tag: interaction.user.tag,
        userId: interaction.user.id,
        guildName: interaction.guild.name,
        memberCount: interaction.guild.memberCount,
        avatar: interaction.user.displayAvatarURL({ size: 256 }),
      };

      const content = cfg.message ? applyPlaceholders(cfg.message, ctx) : `${interaction.user} joined!`;
      const embed = buildEmbed(cfg, ctx);

      const payload = {};
      if (content) payload.content = content;
      if (embed) payload.embeds = [embed];

      const msg = await channel.send(payload).catch(() => null);

      if (msg && cfg.autoDeleteSeconds && Number(cfg.autoDeleteSeconds) > 0) {
        setTimeout(() => msg.delete().catch(() => {}), Math.max(0, Number(cfg.autoDeleteSeconds) * 1000));
      }

      // Optional: DM test too (matches real join behavior)
      if (cfg.dmEnabled) {
        await interaction.user.send(payload).catch(() => {});
      }

      return interaction.editReply(`✅ Sent a test greet message in ${channel}.`);
    }
  },
};