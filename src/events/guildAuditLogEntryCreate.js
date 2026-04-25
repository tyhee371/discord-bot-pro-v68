const { Events } = require('discord.js');
const { getLogConfig, sendLogEmbed } = require('../utils/logService');
const { buildAuditEmbed } = require('../utils/auditFormat');

module.exports = {
  name: Events.GuildAuditLogEntryCreate,
  async execute(client, entry, guild) {
    try {
      if (!guild) return;

      const cfg = await getLogConfig(guild.id);
      if (!cfg.enabled || !cfg.channelId) return;
      if (cfg.events?.audit === false) return;

      const emb = buildAuditEmbed(entry, guild);
      await sendLogEmbed(guild, emb);
    } catch {
      // ignore
    }
  },
};
