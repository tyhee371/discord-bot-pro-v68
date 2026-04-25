const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/settings');
const { isStaff } = require('../../utils/isStaff');
const { build } = require('../../utils/leaveBuilderView');
const { applyPlaceholders } = require('../../utils/placeholders');

function safeUrl(input) {
  try {
    if (!input) return null;
    const u = new URL(String(input));
    return u.href;
  } catch {
    return null;
  }
}

function parseColor(input) {
  if (input == null || input === '') return null;
  const s = String(input).trim();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return parseInt(hex, 16);
  }
  if (/^[0-9]{1,10}$/.test(s)) return Number(s);
  return null;
}

async function sendTest(interaction, settings) {
  const cfg = settings.leave ?? {};
  if (!cfg.channelId) throw new Error('Leave channel is not set.');

  const channel = await interaction.guild.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) throw new Error('Invalid leave channel.');

  const who = interaction.member ?? interaction.user;

  const content = applyPlaceholders(cfg.message ?? 'Goodbye {user}!', who);

  let embeds = [];
  const e = cfg.embed ?? {};
  if (e.enabled) {
    const emb = new EmbedBuilder();

    const title = applyPlaceholders(e.title ?? '', who).trim();
    const desc = applyPlaceholders(e.description ?? '', who).trim();
    if (title) emb.setTitle(title.slice(0, 256));
    if (desc) emb.setDescription(desc.slice(0, 4096));

    const col = parseColor(e.color);
    if (col !== null) emb.setColor(col);

    const thumbUrl = safeUrl(e.thumbnailUrl);
    if (thumbUrl) emb.setThumbnail(thumbUrl);
    else if (e.thumbnail) emb.setThumbnail(interaction.user.displayAvatarURL({ size: 256 }));

    const img = safeUrl(e.imageUrl);
    if (img) emb.setImage(img);

    const footerEnabled = e.footerEnabled !== false;
    if (footerEnabled) {
      const footerText = applyPlaceholders(e.footerText ?? '', who).trim();
      const footerIcon = safeUrl(e.footerIconUrl);
      if (footerText || footerIcon) emb.setFooter({ text: footerText || '\u200b', ...(footerIcon ? { iconURL: footerIcon } : {}) });
      if (e.footerTimestamp) emb.setTimestamp();
    }

    embeds = [emb];
  }

  await channel.send({ content, embeds });
}

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave (goodbye) messages.')
    .addSubcommand((s) => s.setName('builder').setDescription('Open the leave builder UI.'))
    .addSubcommand((s) => s.setName('test').setDescription('Send a test leave message in the configured channel.'))
    .addSubcommand((s) =>
      s
        .setName('set-channel')
        .setDescription('Set the leave channel.')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('set-message')
        .setDescription('Set leave message template.')
        .addStringOption((o) =>
          o
            .setName('message')
            .setDescription('Template. Placeholders: {user} {username} {tag} {id} {server} {memberCount}')
            .setRequired(true),
        ),
    )

    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const settings = await getGuildSettings(interaction.guildId);

    // Keep it role-ID aware, but allow ManageGuild/Administrator too
    if (!isStaff(interaction.member, settings)) {
      return interaction.editReply('You do not have permission to use this.');
    }

    if (sub === 'builder') {
      return interaction.editReply(build(interaction, settings));
    }

    if (sub === 'test') {
      try {
        await sendTest(interaction, settings);
        return interaction.editReply('✅ Test leave message sent.');
      } catch (e) {
        return interaction.editReply(`❌ Could not send test. (${e?.message || String(e)})`);
      }
    }

    if (sub === 'set-channel') {
      const channel = interaction.options.getChannel('channel', true);
      await setGuildSettings(interaction.guildId, { leave: { channelId: channel.id } });
      return interaction.editReply(`✅ Leave channel set to ${channel}.`);
    }

    if (sub === 'set-message') {
      const message = interaction.options.getString('message', true);
      await setGuildSettings(interaction.guildId, { leave: { message } });
      return interaction.editReply(`✅ Leave message updated.`);
    }

    if (sub === 'autodelete') {
      const seconds = interaction.options.getInteger('seconds', true);
      await setGuildSettings(interaction.guildId, { leave: { autoDeleteSeconds: seconds } });
      return interaction.editReply(`✅ Auto-delete set to ${seconds}s.`);
    }
  },
};
