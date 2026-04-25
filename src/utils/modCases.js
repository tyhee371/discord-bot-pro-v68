const { db } = require('../db');

function counterKey(guildId) {
  return `modcaseCounter:${guildId}`;
}
function caseKey(guildId, caseId) {
  return `modcase:${guildId}:${caseId}`;
}
function userIndexKey(guildId, userId) {
  return `modcaseUserIndex:${guildId}:${userId}`;
}
function clampStr(s, max) {
  const v = s == null ? '' : String(s);
  return v.length > max ? v.slice(0, max - 3) + '...' : v;
}

async function nextCaseId(guildId) {
  const key = counterKey(guildId);
  const cur = (await db.get(key)) ?? 0;
  const next = Number(cur) + 1;
  await db.set(key, next);
  return next;
}


async function createCaseWithId(guildId, caseId, data) {
  const id = Number(caseId);
  if (!Number.isFinite(id) || id < 1) throw new Error('Invalid caseId');
  // Ensure counter is at least this high
  const key = counterKey(guildId);
  const cur = (await db.get(key)) ?? 0;
  if (Number(cur) < id) await db.set(key, id);

  const createdAt = Date.now();
  const c = {
    id,
    guildId,
    type: data.type ?? 'unknown',
    action: data.action ?? data.type ?? 'unknown',
    moderatorId: data.moderatorId ?? null,
    targetId: data.targetId ?? null,
    reason: clampStr(data.reason ?? 'None', 1800),
    durationMs: data.durationMs ?? null,
    createdAt,
    extra: data.extra ?? {},
    logMessageId: data.logMessageId ?? null,
    logChannelId: data.logChannelId ?? null,
    appeals: data.appeals ?? [],
    updatedAt: createdAt,
  };

  await db.set(caseKey(guildId, id), c);

  if (c.targetId) {
    const uKey = userIndexKey(guildId, c.targetId);
    const arr = (await db.get(uKey)) ?? [];
    arr.push(id);
    const trimmed = arr.slice(-200);
    await db.set(uKey, trimmed);
  }

  return c;
}

async function createCase(guildId, data) {
  const caseId = await nextCaseId(guildId);
  const createdAt = Date.now();
  const c = {
    id: caseId,
    guildId,
    type: data.type ?? 'unknown',
    action: data.action ?? data.type ?? 'unknown',
    moderatorId: data.moderatorId ?? null,
    targetId: data.targetId ?? null,
    reason: clampStr(data.reason ?? 'None', 1800),
    durationMs: data.durationMs ?? null,
    createdAt,
    extra: data.extra ?? {},
    logMessageId: data.logMessageId ?? null,
    logChannelId: data.logChannelId ?? null,
    appeals: data.appeals ?? [],
    updatedAt: createdAt,
  };

  await db.set(caseKey(guildId, caseId), c);

  // Index by target
  if (c.targetId) {
    const uKey = userIndexKey(guildId, c.targetId);
    const arr = (await db.get(uKey)) ?? [];
    arr.push(caseId);
    // keep last 200 to cap growth
    const trimmed = arr.slice(-200);
    await db.set(uKey, trimmed);
  }

  return c;
}

async function getCase(guildId, caseId) {
  const id = Number(caseId);
  if (!Number.isFinite(id) || id < 1) return null;
  return (await db.get(caseKey(guildId, id))) ?? null;
}

async function listCasesForUser(guildId, userId, limit = 10) {
  const ids = (await db.get(userIndexKey(guildId, userId))) ?? [];
  const slice = ids.slice(-Math.max(1, Math.min(50, limit))).reverse();
  const out = [];
  for (const id of slice) {
    const c = await getCase(guildId, id);
    if (c) out.push(c);
  }
  return out;
}

async function updateCase(guildId, caseId, patch) {
  const c = await getCase(guildId, caseId);
  if (!c) return null;
  const next = {
    ...c,
    ...patch,
    updatedAt: Date.now(),
  };
  await db.set(caseKey(guildId, c.id), next);
  return next;
}

async function addAppeal(guildId, caseId, appeal) {
  const c = await getCase(guildId, caseId);
  if (!c) return null;
  const appeals = Array.isArray(c.appeals) ? c.appeals.slice() : [];
  appeals.push({
    id: appeal.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    userId: appeal.userId,
    message: clampStr(appeal.message ?? '', 1800),
    createdAt: Date.now(),
  });
  const updated = await updateCase(guildId, caseId, { appeals });
  return updated;
}

module.exports = {
  nextCaseId,
  createCaseWithId,
  createCase,
  getCase,
  listCasesForUser,
  updateCase,
  addAppeal,
};
