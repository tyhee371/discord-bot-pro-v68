function parseUserId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  const m = trimmed.match(/^<@!?(\d+)>$/) || trimmed.match(/^(\d{17,20})$/);
  return m ? m[1] : null;
}

module.exports = { parseUserId };
