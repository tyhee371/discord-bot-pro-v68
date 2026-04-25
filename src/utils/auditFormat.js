const {
  EmbedBuilder,
  AuditLogEvent,
  PermissionsBitField,
  ChannelType,
  Role,
} = require('discord.js');

function safe(s, max = 1024) {
  const v = String(s ?? '');
  if (!v.length) return '—';
  if (v.length <= max) return v;
  return v.slice(0, max - 1) + '…';
}

function tagUser(u) {
  if (!u) return 'Unknown';
  return `${u.tag ?? u.username ?? 'Unknown'} (${u.id})`;
}

function mentionRole(role) {
  if (!role) return 'Unknown';
  return role.id ? `<@&${role.id}> (${role.id})` : safe(role.name);
}

function mentionChannelId(id) {
  if (!id) return '—';
  return `<#${id}> (${id})`;
}

function humanChannelType(t) {
  const map = {
    [ChannelType.GuildText]: 'Text',
    [ChannelType.GuildVoice]: 'Voice',
    [ChannelType.GuildCategory]: 'Category',
    [ChannelType.GuildAnnouncement]: 'Announcement',
    [ChannelType.PublicThread]: 'Thread',
    [ChannelType.PrivateThread]: 'Private Thread',
    [ChannelType.GuildStageVoice]: 'Stage',
    [ChannelType.GuildForum]: 'Forum',
  };
  return map[t] ?? String(t);
}

function permDiff(oldVal, newVal) {
  try {
    const o = BigInt(oldVal ?? 0);
    const n = BigInt(newVal ?? 0);
    const added = n & ~o;
    const removed = o & ~n;

    const addedNames = new PermissionsBitField(added).toArray();
    const removedNames = new PermissionsBitField(removed).toArray();

    return {
      added: addedNames.length ? addedNames.join(', ') : null,
      removed: removedNames.length ? removedNames.join(', ') : null,
    };
  } catch {
    return { added: null, removed: null };
  }
}

function parseRoleArray(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr
    .slice(0, 15)
    .map((r) => `<@&${r.id}>`)
    .join(' ');
}

function change(entry, key) {
  return (entry?.changes ?? []).find((c) => c.key === key);
}

function addField(fields, name, value, inline = false) {
  if (value === null || value === undefined) return;
  const v = safe(value, 1024);
  if (!v || v === '—') return;
  fields.push({ name, value: v, inline });
}

function formatChangesGeneric(entry) {
  const fields = [];
  const changes = entry?.changes ?? [];
  for (const c of changes.slice(0, 8)) {
    const before = typeof c.old === 'object' ? '[object]' : String(c.old ?? '—');
    const after = typeof c.new === 'object' ? '[object]' : String(c.new ?? '—');
    addField(fields, safe(c.key, 128), `${safe(before, 480)} → ${safe(after, 480)}`, false);
  }
  return fields;
}

/**
 * Builds a richer embed for common audit actions.
 * Returns an EmbedBuilder.
 */
function buildAuditEmbed(entry, guild) {
  const actionName =
    Object.keys(AuditLogEvent).find((k) => AuditLogEvent[k] === entry.action) || String(entry.action);

  const emb = new EmbedBuilder()
    .setTitle(`Audit Log: ${actionName}`)
    .setTimestamp(new Date(entry.createdTimestamp ?? Date.now()));

  // color heuristic
  const a = actionName.toLowerCase();
  if (a.includes('delete')) emb.setColor(0xed4245);
  else if (a.includes('create')) emb.setColor(0x57f287);
  else if (a.includes('update') || a.includes('edit')) emb.setColor(0x5865f2);
  else if (a.includes('ban') || a.includes('kick')) emb.setColor(0xfaa61a);
  else emb.setColor(0xfee75c);

  // executor
  if (entry.executor) {
    emb.setAuthor({
      name: tagUser(entry.executor),
      iconURL: entry.executor.displayAvatarURL?.() ?? undefined,
    });
  }

  const fields = [];
  addField(fields, 'Executor', tagUser(entry.executor), true);

  // target display
  const target = entry.target;
  if (target) {
    if (target instanceof Role) addField(fields, 'Target', mentionRole(target), true);
    else if (target?.id && typeof target?.name === 'string') addField(fields, 'Target', `${safe(target.name)} (${target.id})`, true);
    else if (target?.id && target?.tag) addField(fields, 'Target', `${target.tag} (${target.id})`, true);
    else if (target?.id) addField(fields, 'Target', String(target.id), true);
  } else {
    addField(fields, 'Target', 'Unknown', true);
  }

  if (entry.reason) addField(fields, 'Reason', entry.reason, false);

  // Action-specific formatting
  switch (entry.action) {
    // CHANNELS
    case AuditLogEvent.ChannelCreate:
    case AuditLogEvent.ChannelDelete:
    case AuditLogEvent.ChannelUpdate: {
      const extra = entry.extra ?? {};
      // For update, show before/after name/topic/parent etc if present
      const nameCh = change(entry, 'name');
      if (nameCh) addField(fields, 'Name', `${safe(nameCh.old)} → ${safe(nameCh.new)}`, false);

      const typeCh = change(entry, 'type');
      if (typeCh) addField(fields, 'Type', `${humanChannelType(typeCh.old)} → ${humanChannelType(typeCh.new)}`, true);

      const parentCh = change(entry, 'parent_id');
      if (parentCh) addField(fields, 'Category', `${mentionChannelId(parentCh.old)} → ${mentionChannelId(parentCh.new)}`, false);

      const topicCh = change(entry, 'topic');
      if (topicCh) addField(fields, 'Topic', `${safe(topicCh.old, 500)} → ${safe(topicCh.new, 500)}`, false);

      const slowCh = change(entry, 'rate_limit_per_user');
      if (slowCh) addField(fields, 'Slowmode', `${safe(slowCh.old)} → ${safe(slowCh.new)}`, true);

      const nsfwCh = change(entry, 'nsfw');
      if (nsfwCh) addField(fields, 'NSFW', `${safe(nsfwCh.old)} → ${safe(nsfwCh.new)}`, true);

      const bitrateCh = change(entry, 'bitrate');
      if (bitrateCh) addField(fields, 'Bitrate', `${safe(bitrateCh.old)} → ${safe(bitrateCh.new)}`, true);

      const userLimitCh = change(entry, 'user_limit');
      if (userLimitCh) addField(fields, 'User limit', `${safe(userLimitCh.old)} → ${safe(userLimitCh.new)}`, true);

      const rtcCh = change(entry, 'rtc_region');
      if (rtcCh) addField(fields, 'RTC Region', `${safe(rtcCh.old)} → ${safe(rtcCh.new)}`, true);

      // If we have extra channel id
      if (extra.channelId) addField(fields, 'Channel', mentionChannelId(extra.channelId), false);
      break;
    }

    // ROLES
    case AuditLogEvent.RoleCreate:
    case AuditLogEvent.RoleDelete:
    case AuditLogEvent.RoleUpdate: {
      const nameCh = change(entry, 'name');
      if (nameCh) addField(fields, 'Name', `${safe(nameCh.old)} → ${safe(nameCh.new)}`, false);

      const colorCh = change(entry, 'color');
      if (colorCh) addField(fields, 'Color', `${safe(colorCh.old)} → ${safe(colorCh.new)}`, true);

      const hoistCh = change(entry, 'hoist');
      if (hoistCh) addField(fields, 'Hoist', `${safe(hoistCh.old)} → ${safe(hoistCh.new)}`, true);

      const mentionCh = change(entry, 'mentionable');
      if (mentionCh) addField(fields, 'Mentionable', `${safe(mentionCh.old)} → ${safe(mentionCh.new)}`, true);

      const permCh = change(entry, 'permissions');
      if (permCh) {
        const diff = permDiff(permCh.old, permCh.new);
        if (diff.added) addField(fields, 'Permissions added', diff.added, false);
        if (diff.removed) addField(fields, 'Permissions removed', diff.removed, false);
      }

      break;
    }

    // MEMBER ROLE UPDATE (add/remove roles)
    case AuditLogEvent.MemberRoleUpdate: {
      const addCh = change(entry, '$add');
      const remCh = change(entry, '$remove');
      if (addCh?.new) addField(fields, 'Roles added', parseRoleArray(addCh.new), false);
      if (remCh?.new) addField(fields, 'Roles removed', parseRoleArray(remCh.new), false);
      break;
    }

    // MESSAGE DELETE / BULK DELETE (audit-log based)
    case AuditLogEvent.MessageDelete:
    case AuditLogEvent.MessageBulkDelete: {
      const extra = entry.extra ?? {};
      if (extra.channelId) addField(fields, 'Channel', mentionChannelId(extra.channelId), false);
      if (extra.count) addField(fields, 'Count', String(extra.count), true);
      break;
    }

    // WEBHOOKS
    case AuditLogEvent.WebhookCreate:
    case AuditLogEvent.WebhookDelete:
    case AuditLogEvent.WebhookUpdate: {
      const nameCh = change(entry, 'name');
      if (nameCh) addField(fields, 'Name', `${safe(nameCh.old)} → ${safe(nameCh.new)}`, false);
      const chCh = change(entry, 'channel_id');
      if (chCh) addField(fields, 'Channel', `${mentionChannelId(chCh.old)} → ${mentionChannelId(chCh.new)}`, false);
      break;
    }

    // EMOJIS
    case AuditLogEvent.EmojiCreate:
    case AuditLogEvent.EmojiDelete:
    case AuditLogEvent.EmojiUpdate: {
      const nameCh = change(entry, 'name');
      if (nameCh) addField(fields, 'Name', `${safe(nameCh.old)} → ${safe(nameCh.new)}`, false);
      break;
    }

    // STICKERS
    case AuditLogEvent.StickerCreate:
    case AuditLogEvent.StickerDelete:
    case AuditLogEvent.StickerUpdate: {
      const nameCh = change(entry, 'name');
      if (nameCh) addField(fields, 'Name', `${safe(nameCh.old)} → ${safe(nameCh.new)}`, false);
      break;
    }

    // DEFAULT
    default: {
      const generic = formatChangesGeneric(entry);
      for (const f of generic) fields.push(f);
      break;
    }
  }

  // Trim fields to Discord limits
  emb.addFields(fields.slice(0, 25));
  return emb;
}

module.exports = { buildAuditEmbed };
