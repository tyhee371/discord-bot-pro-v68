const { EmbedBuilder, AuditLogEvent } = require('discord.js');
const { getGuildSettings } = require('../stores/settings');

async function getLogConfig(guildId) {
  const s = await getGuildSettings(guildId);
  const cfg = s.logs ?? {};
  return {
    enabled: Boolean(cfg.enabled),
    channelId: cfg.channelId ?? null,
    ignoreBots: cfg.ignoreBots !== false,
    events: {
      member: cfg.events?.member !== false,  // join/leave log
      channel: cfg.events?.channel !== false,
      channelUpdate: cfg.events?.channelUpdate !== false,
      voice: cfg.events?.voice !== false,
      messageEdit: cfg.events?.messageEdit !== false,
      messageDelete: cfg.events?.messageDelete !== false,
      bulkDelete: cfg.events?.bulkDelete !== false,
      attachmentRemove: cfg.events?.attachmentRemove !== false,
      role: cfg.events?.role !== false,
      audit: cfg.events?.audit !== false,
    },
  };
}

async function resolveLogChannel(guild, channelId) {
  if (!guild || !channelId) return null;
  const ch = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!ch) return null;
  if (!ch.isTextBased?.()) return null;
  return ch;
}

function clamp(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}

function safeField(text) {
  const t = String(text ?? '').trim();
  return t.length ? clamp(t, 1024) : '\u200b';
}

function safeUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(String(u));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function sendLogEmbed(guild, embed, extra = {}) {
  const cfg = await getLogConfig(guild.id);
  if (!cfg.enabled || !cfg.channelId) return false;

  const ch = await resolveLogChannel(guild, cfg.channelId);
  if (!ch) return false;

  await ch.send({ embeds: [embed], ...extra }).catch(() => {});
  return true;
}

async function fetchRecentAuditEntry(guild, type, predicate, maxAgeMs = 8000, limit = 6) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit }).catch(() => null);
    if (!logs) return null;
    const now = Date.now();

    for (const entry of logs.entries.values()) {
      if (!entry) continue;
      if (now - entry.createdTimestamp > maxAgeMs) continue;
      if (!predicate || predicate(entry)) return entry;
    }
    return null;
  } catch {
    return null;
  }
}

async function findMessageDeleteAudit(guild, targetUserId, channelId) {
  return fetchRecentAuditEntry(
    guild,
    AuditLogEvent.MessageDelete,
    (e) => e?.target?.id === targetUserId && (e?.extra?.channel?.id === channelId || e?.extra?.channelId === channelId),
  );
}

async function findChannelUpdateAudit(guild, channelId) {
  return fetchRecentAuditEntry(guild, AuditLogEvent.ChannelUpdate, (e) => e?.target?.id === channelId);
}



async function findMessageBulkDeleteAudit(guild, channelId) {
  return fetchRecentAuditEntry(
    guild,
    AuditLogEvent.MessageBulkDelete,
    (e) => e?.target?.id === channelId || e?.extra?.channel?.id === channelId || e?.extra?.channelId === channelId,
  );
}


module.exports = {
  getLogConfig,
  resolveLogChannel,
  clamp,
  safeField,
  safeUrl,
  sendLogEmbed,
  fetchRecentAuditEntry,
  findMessageDeleteAudit,
  findChannelUpdateAudit,
  findMessageBulkDeleteAudit,
};
