const { EmbedBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGuildSettings } = require('../stores/settings');
const { safeReply } = require('../helpers/safeReply');
const { nextCaseId, createCaseWithId, updateCase, getCase } = require('../stores/modCases');

async function getModLogConfig(guildId) {
  const s = await getGuildSettings(guildId);
  const cfg = s.modLogs ?? {};
  return {
    enabled: Boolean(cfg.enabled),
    channelId: cfg.channelId ?? null,
    appeals: {
      enabled: Boolean(cfg.appeals?.enabled),
      channelId: cfg.appeals?.channelId ?? null,
    },
  };
}

async function resolveModLogChannel(guild, channelId) {
  if (!guild || !channelId) return null;
  const ch = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!ch) return null;
  if (!ch.isTextBased?.()) return null;
  if (ch.type === ChannelType.DM) return null;
  return ch;
}

/**
 * Soft-check: resolve the mod log channel if configured.
 * Returns the channel object if configured and reachable, null otherwise.
 * DOES NOT block the calling command — commands can still proceed without a mod log channel.
 * Callers that REQUIRE mod logs (e.g. modlogs setup itself) should check the return value.
 */
async function requireModLog(interaction) {
  if (!interaction.guild) return null;

  const cfg = await getModLogConfig(interaction.guildId);
  if (!cfg.enabled || !cfg.channelId) return null;

  return resolveModLogChannel(interaction.guild, cfg.channelId);
}

/**
 * Hard-check: block the command if mod logs are not configured.
 * Use this only in commands where mod logs are strictly required.
 */
async function requireModLogStrict(interaction) {
  if (!interaction.guild) {
    const msg = '❌ This command can only be used in a server.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: msg }).catch(() => {});
    } else {
      await safeReply(interaction, { ephemeral: true, content: msg }).catch(() => {});
    }
    return null;
  }

  const cfg = await getModLogConfig(interaction.guildId);
  if (!cfg.enabled || !cfg.channelId) {
    const msg = '❌ **Mod logs channel is not configured.**\nUse `/modlogs setup` to set it before using moderation commands.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: msg }).catch(() => {});
    } else {
      await safeReply(interaction, { ephemeral: true, content: msg }).catch(() => {});
    }
    return null;
  }

  const ch = await resolveModLogChannel(interaction.guild, cfg.channelId);
  if (!ch) {
    const msg = '❌ Mod logs channel is invalid/missing. Please run `/modlogs setup` again.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: msg }).catch(() => {});
    } else {
      await safeReply(interaction, { ephemeral: true, content: msg }).catch(() => {});
    }
    return null;
  }

  return ch;
}

async function sendModLogEmbed(guild, embed, extra = {}) {
  const cfg = await getModLogConfig(guild.id);
  if (!cfg.enabled || !cfg.channelId) return false;
  const ch = await resolveModLogChannel(guild, cfg.channelId);
  if (!ch) return false;
  await ch.send({ embeds: [embed], ...extra }).catch(() => {});
  return true;
}

function buildModActionEmbed({ title, moderator, target, reason, fields = [], footer, caseId }) {
  const emb = new EmbedBuilder().setTitle(title).setTimestamp();

  if (moderator) {
    emb.addFields({ name: 'Moderator', value: `<@${moderator.id}> (${moderator.id})`, inline: false });
  }
  if (target) {
    emb.addFields({ name: 'Target', value: `<@${target.id}> (${target.id})`, inline: false });
  }
  if (reason) {
    emb.addFields({ name: 'Reason', value: String(reason).slice(0, 1024), inline: false });
  }

  if (fields?.length) emb.addFields(...fields);

  const footerBits = [];
  if (footer) footerBits.push(String(footer).slice(0, 200));
  if (caseId) footerBits.push(`Case #${caseId}`);
  if (footerBits.length) emb.setFooter({ text: footerBits.join(' • ').slice(0, 2048) });

  return emb;
}

async function resolveAppealChannel(guild) {
  const cfg = await getModLogConfig(guild.id);
  if (!cfg.appeals.enabled || !cfg.appeals.channelId) return null;
  return resolveModLogChannel(guild, cfg.appeals.channelId);
}

/**
 * Create a moderation case, send it to mod logs, and optionally DM the target with an Appeal button.
 * Returns the created case object (includes id).
 */
async function createAndSendCase({
  guild,
  type,
  title,
  moderator,
  target,
  reason,
  fields = [],
  durationMs = null,
  dmTarget = true,
  extra = {},
}) {
  // Normalize reasons so moderation actions always show a consistent "None" default.
  const normalizedReason = (reason === null || reason === undefined || String(reason).trim() === '') ? 'None' : String(reason);
  const cfg = await getModLogConfig(guild.id);
  if (!cfg.enabled || !cfg.channelId) return null;

  const logCh = await resolveModLogChannel(guild, cfg.channelId);
  if (!logCh) return null;

  const caseId = await nextCaseId(guild.id);

  const emb = buildModActionEmbed({
    title,
    moderator,
    target,
    reason: normalizedReason,
    fields,
    caseId,
  });

  const msg = await logCh.send({ embeds: [emb] }).catch(() => null);
  if (!msg) return null;

  const c = await createCaseWithId(guild.id, caseId, {
    type,
    action: type,
    moderatorId: moderator?.id ?? null,
    targetId: target?.id ?? null,
    reason: normalizedReason,
    durationMs,
    extra: extra ?? {},
    logMessageId: msg.id,
    logChannelId: logCh.id,
  });

  // DM target with Appeal button
  if (dmTarget && target?.id) {
    const appealCfg = await getModLogConfig(guild.id);
    const canAppeal = appealCfg.appeals.enabled && appealCfg.appeals.channelId;
    if (canAppeal) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`appeal:open:${guild.id}:${caseId}`)
          .setLabel('Appeal')
          .setStyle(ButtonStyle.Secondary),
      );

      const dmEmb = new EmbedBuilder()
        .setTitle('Moderation Action')
        .setDescription(`A moderation action was taken in **${guild.name}**.`)
        .addFields(
          { name: 'Type', value: String(type).toUpperCase(), inline: true },
          { name: 'Case', value: `#${caseId}`, inline: true },
          { name: 'Reason', value: String(normalizedReason ?? 'None').slice(0, 1024), inline: false },
        )
        .setFooter({ text: 'If you believe this is a mistake, you can submit an appeal.' })
        .setTimestamp();

      await target.send({ embeds: [dmEmb], components: [row] }).catch(() => {});
    }
  }

  return c;
}

/** Update the mod-log message embed reason for a case (best-effort). */
async function updateCaseLogReason(client, guildId, caseId, newReason, editorUser) {
  const cKey = Number(caseId);
  if (!Number.isFinite(cKey)) return null;
  const c = await getCase(guildId, cKey);
  if (!c?.logChannelId || !c?.logMessageId) {
    return c;
  }

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return c;

  const ch = await resolveModLogChannel(guild, c.logChannelId);
  if (!ch) return c;

  const msg = await ch.messages.fetch(c.logMessageId).catch(() => null);
  if (!msg) return c;

  const emb = EmbedBuilder.from(msg.embeds?.[0] ?? new EmbedBuilder().setTitle('Moderation Action'));
  // Replace/insert Reason field
  const fields = emb.data.fields ? [...emb.data.fields] : [];
  const idx = fields.findIndex((f) => (f.name || '').toLowerCase() === 'reason');
  const reasonField = { name: 'Reason', value: String(newReason).slice(0, 1024), inline: false };
  if (idx >= 0) fields[idx] = reasonField;
  else fields.push(reasonField);
  emb.setFields(fields);

  const footerBits = [];
  const existingFooter = msg.embeds?.[0]?.footer?.text;
  if (existingFooter) footerBits.push(existingFooter.replace(/\s*•?\s*Case\s*#\d+\s*/i, '').trim());
  footerBits.push(`Case #${cKey}`);
  emb.setFooter({ text: footerBits.filter(Boolean).join(' • ').slice(0, 2048) });

  await msg.edit({ embeds: [emb] }).catch(() => {});

  await updateCase(guildId, cKey, { reason: newReason, extra: { ...(c.extra ?? {}), reasonEditedBy: editorUser?.id ?? null } });

  return c;
}

module.exports = {
  getModLogConfig,
  resolveModLogChannel,
  requireModLog,
  requireModLogStrict,
  sendModLogEmbed,
  buildModActionEmbed,
  resolveAppealChannel,
  createAndSendCase,
  updateCaseLogReason,
};
