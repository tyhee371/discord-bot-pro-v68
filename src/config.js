function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

function parseOwnerIds(v) {
  if (!v) return [];
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

module.exports = {
  token: requireEnv('DISCORD_TOKEN'),
  clientId: requireEnv('CLIENT_ID'),
  guildId: process.env.GUILD_ID || null,
  ownerIds: parseOwnerIds(process.env.OWNER_IDS || ''),
  keyvUrl: process.env.KEYV_URL || 'sqlite://database.sqlite',

  // Optional legal links shown by /help and !help
  privacyPolicyUrl: process.env.PRIVACY_POLICY_URL || '',
  termsUrl: process.env.TERMS_URL || '',
};
