const {
  ActionRowBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} = require('discord.js');

const { getGuildSettings, setGuildSettings } = require('../../utils/settings');
const { build } = require('../../utils/greetBuilderView');
const { applyPlaceholders } = require('../../utils/placeholders');

function safeUrl(input) {
  try {
    if (!input) return null;
    const u = new URL(String(input));
    if (!['http:', 'https:'].includes(u.protocol)) return null;
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

function modalMessage(settings) {
  const cfg = settings.greet ?? {};
  const modal = new ModalBuilder().setCustomId('greet:modal_message').setTitle('Greeting Message');

  const msg = new TextInputBuilder()
    .setCustomId('message')
    .setLabel('Message (placeholders supported)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1800)
    .setValue(cfg.message ?? 'Welcome {user}!');

  modal.addComponents(new ActionRowBuilder().addComponents(msg));
  return modal;
}

function modalEmbed(settings) {
  const cfg = settings.greet ?? {};
  const e = cfg.embed ?? {};

  const modal = new ModalBuilder().setCustomId('greet:modal_embed').setTitle('Greeting Embed');

  const title = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Title (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(256)
    .setValue(e.title ?? '');

  const description = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Description (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(2000)
    .setValue(e.description ?? '');

  const color = new TextInputBuilder()
    .setCustomId('color')
    .setLabel('Color (hex like #ff00ff) (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(32)
    .setValue(e.color ?? '');

  const thumbnailUrl = new TextInputBuilder()
    .setCustomId('thumbnailUrl')
    .setLabel('Thumbnail URL (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(400)
    .setValue(e.thumbnailUrl ?? '');

  const imageUrl = new TextInputBuilder()
    .setCustomId('imageUrl')
    .setLabel('Image URL (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(400)
    .setValue(e.imageUrl ?? '');

  modal.addComponents(
    new ActionRowBuilder().addComponents(title),
    new ActionRowBuilder().addComponents(description),
    new ActionRowBuilder().addComponents(color),
    new ActionRowBuilder().addComponents(thumbnailUrl),
    new ActionRowBuilder().addComponents(imageUrl),
  );

  return modal;
}

function modalAutodel(settings) {
  const cfg = settings.greet ?? {};
  const modal = new ModalBuilder().setCustomId('greet:modal_autodel').setTitle('Auto Delete');

  const seconds = new TextInputBuilder()
    .setCustomId('seconds')
    .setLabel('Seconds (0 to disable)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(8)
    .setValue(String(cfg.autoDeleteSeconds ?? 0));

  modal.addComponents(new ActionRowBuilder().addComponents(seconds));
  return modal;
}

function modalFooter(settings) {
  const cfg = settings.greet ?? {};
  const e = cfg.embed ?? {};

  const modal = new ModalBuilder().setCustomId('greet:modal_footer').setTitle('Greeting Footer');

  const footerText = new TextInputBuilder()
    .setCustomId('footerText')
    .setLabel('Footer text (leave empty to disable)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(2000)
    .setValue(e.footerText ?? '');

  const footerIconUrl = new TextInputBuilder()
    .setCustomId('footerIconUrl')
    .setLabel('Footer icon URL (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(400)
    .setValue(e.footerIconUrl ?? '');

  modal.addComponents(
    new ActionRowBuilder().addComponents(footerText),
    new ActionRowBuilder().addComponents(footerIconUrl),
  );

  return modal;
}

async function sendTest(interaction, settings) {
  const cfg = settings.greet ?? {};
  if (!cfg.channelId) throw new Error('Greet channel is not set.');

  const channel = await interaction.guild.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) throw new Error('Invalid greet channel.');

  const who = interaction.member ?? interaction.user;

  const content = applyPlaceholders(cfg.message ?? 'Welcome {user}!', who);

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

    const thumbUrl = safeUrl(applyPlaceholders(e.thumbnailUrl ?? '', who).trim());
    if (thumbUrl) emb.setThumbnail(thumbUrl);
    else if (e.thumbnail) emb.setThumbnail(interaction.user.displayAvatarURL({ size: 256 }));

    const img = safeUrl(applyPlaceholders(e.imageUrl ?? '', who).trim());
    if (img) emb.setImage(img);

    const footerEnabled = e.footerEnabled !== false;
    if (footerEnabled) {
      const footerText = applyPlaceholders(e.footerText ?? '', who).trim();
      const footerIcon = safeUrl(applyPlaceholders(e.footerIconUrl ?? '', who).trim());
      if (footerText || footerIcon) emb.setFooter({ text: footerText || '\u200b', ...(footerIcon ? { iconURL: footerIcon } : {}) });
      if (e.footerTimestamp) emb.setTimestamp();
    }

    embeds = [emb];
  }

  await channel.send({ content, embeds });

  // optional DM (matches real join behavior)
  if (cfg.dmEnabled) {
    await interaction.user.send({ content, embeds }).catch(() => {});
  }
}

module.exports = {
  id: 'greet',
  async execute(interaction) {
    const settings = await getGuildSettings(interaction.guildId);
    const cfg = settings.greet ?? {};
    const e = cfg.embed ?? {};

    const [, action] = interaction.customId.split(':');

    if (action === 'toggle_enabled') {
      await setGuildSettings(interaction.guildId, { greet: { ...cfg, enabled: !cfg.enabled } });
      const updated = await getGuildSettings(interaction.guildId);
      return interaction.update(build(interaction, updated));
    }

    if (action === 'toggle_embed') {
      await setGuildSettings(interaction.guildId, { greet: { ...cfg, embed: { ...e, enabled: !e.enabled } } });
      const updated = await getGuildSettings(interaction.guildId);
      return interaction.update(build(interaction, updated));
    }

    if (action === 'toggle_dm') {
      await setGuildSettings(interaction.guildId, { greet: { ...cfg, dmEnabled: !cfg.dmEnabled } });
      const updated = await getGuildSettings(interaction.guildId);
      return interaction.update(build(interaction, updated));
    }

    if (action === 'toggle_thumb') {
      await setGuildSettings(interaction.guildId, { greet: { ...cfg, embed: { ...e, thumbnail: !e.thumbnail } } });
      const updated = await getGuildSettings(interaction.guildId);
      return interaction.update(build(interaction, updated));
    }

    if (action === 'refresh') {
      const updated = await getGuildSettings(interaction.guildId);
      return interaction.update(build(interaction, updated));
    }

    if (action === 'test') {
      try {
        await sendTest(interaction, settings);
        return interaction.reply({ content: '✅ Test greeting sent.', ephemeral: true });
      } catch (err) {
        return interaction.reply({ content: `❌ Could not send test. (${err.message})`, ephemeral: true });
      }
    }

    if (action === 'edit_message') return interaction.showModal(modalMessage(settings));
    if (action === 'edit_embed') return interaction.showModal(modalEmbed(settings));
    if (action === 'auto_delete') return interaction.showModal(modalAutodel(settings));
    if (action === 'edit_footer') return interaction.showModal(modalFooter(settings));

    if (action === 'toggle_footer') {
      const currentEnabled = e.footerEnabled !== false;
      await setGuildSettings(interaction.guildId, { greet: { ...cfg, embed: { ...e, footerEnabled: !currentEnabled } } });
      const updated = await getGuildSettings(interaction.guildId);
      return interaction.update(build(interaction, updated));
    }

    if (action === 'toggle_ts') {
      const nextTs = !e.footerTimestamp;
      await setGuildSettings(interaction.guildId, {
        greet: {
          ...cfg,
          embed: { ...e, footerTimestamp: nextTs, footerEnabled: nextTs ? true : (e.footerEnabled ?? true) },
        },
      });
      const updated = await getGuildSettings(interaction.guildId);
      return interaction.update(build(interaction, updated));
    }

    if (action === 'clear_footer') {
      await setGuildSettings(interaction.guildId, {
        greet: { ...cfg, embed: { ...e, footerText: '', footerIconUrl: '', footerTimestamp: false, footerEnabled: false } },
      });
      const updated = await getGuildSettings(interaction.guildId);
      return interaction.update(build(interaction, updated));
    }

    return interaction.reply({ content: 'Unknown action.', ephemeral: true });
  },
};
