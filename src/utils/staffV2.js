
function presenceIsOnline(p) {
  const s = p?.status;
  return s === 'online' || s === 'idle' || s === 'dnd';
}

async function getStaffCandidates(guild, settings) {
  const adminRoleId = settings?.tickets?.adminRoleId ?? null;
  const modRoleId = settings?.tickets?.modRoleId ?? settings?.tickets?.supportRoleId ?? null;

  const candidates = new Map(); // id -> member

  const addRoleMembers = (roleId) => {
    if (!roleId) return;
    const role = guild.roles.cache.get(roleId);
    if (!role) return;
    role.members.forEach((m) => {
      if (!m.user.bot) candidates.set(m.id, m);
    });
  };

  addRoleMembers(adminRoleId);
  addRoleMembers(modRoleId);

  return [...candidates.values()];
}

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function chooseStaff(memberList, attemptedIds = [], preferOnline = true) {
  const attempted = new Set(attemptedIds);
  let pool = memberList.filter(m => !attempted.has(m.id));

  if (preferOnline) {
    const onlinePool = pool.filter(m => presenceIsOnline(m.presence));
    if (onlinePool.length > 0) pool = onlinePool;
  }

  return pickRandom(pool);
}

module.exports = { getStaffCandidates, chooseStaff };
