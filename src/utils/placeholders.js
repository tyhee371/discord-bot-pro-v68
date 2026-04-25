
// Placeholder engine used by greet/leave templates and embed URLs.
// Supports escaping placeholders with a backslash: \{user} -> {user}
//
// Supported placeholders:
// {user} / {mention} - mention the user
// {username}         - username
// {tag}              - username#1234
// {userid}           - user id
// {avatar}           - user avatar URL
// {server}           - guild/server name
// {membercount}      - guild member count
function buildContext(input) {
  // If it's already a context object (used by older code), keep it.
  if (input && typeof input === 'object' && ('userMention' in input || 'username' in input)) {
    const ctx = input;
    return {
      userMention: ctx.userMention ?? ctx.mention ?? '',
      username: ctx.username ?? '',
      tag: ctx.tag ?? '',
      userId: ctx.userId ?? ctx.userid ?? '',
      avatar: ctx.avatar ?? '',
      guildName: ctx.guildName ?? ctx.server ?? '',
      memberCount: ctx.memberCount ?? ctx.membercount ?? '',
    };
  }

  // Otherwise assume it's a Discord GuildMember.
  const member = input;
  const user = member?.user ?? member;
  const guild = member?.guild ?? null;

  return {
    userMention: user ? `<@${user.id}>` : '',
    username: user?.username ?? '',
    tag: user?.tag ?? `${user?.username ?? ''}`.trim(),
    userId: user?.id ?? '',
    avatar: user?.displayAvatarURL?.({ size: 1024 }) ?? user?.avatarURL?.({ size: 1024 }) ?? '',
    guildName: guild?.name ?? '',
    memberCount: guild?.memberCount ?? '',
  };
}

function applyPlaceholders(template, memberOrCtx) {
  if (!template) return '';

  const ctx = buildContext(memberOrCtx);

  const ESC = '\uE000'; // private-use placeholder
  let out = String(template).replace(/\\\{/g, ESC);

  const map = {
    user: ctx.userMention,
    mention: ctx.userMention,
    username: ctx.username,
    tag: ctx.tag,
    userid: String(ctx.userId ?? ''),
    avatar: String(ctx.avatar ?? ''),
    server: String(ctx.guildName ?? ''),
    membercount: String(ctx.memberCount ?? ''),
  };

  out = out.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, keyRaw) => {
    const key = String(keyRaw).toLowerCase();
    return key in map ? (map[key] ?? '') : m;
  });

  out = out.replace(new RegExp(ESC, 'g'), '{');
  return out;
}

module.exports = { applyPlaceholders };
