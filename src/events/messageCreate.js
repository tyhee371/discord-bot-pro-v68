const { Events } = require('discord.js');
const { runRules } = require('../utils/ruleEngine');
const { screenMessage, buildFlagEmbed } = require('../utils/aiModeration');
const { getGuildSettings } = require('../utils/settings');
const { metrics } = require('../utils/metrics');
const { logger } = require('../utils/logger');
const { handlePrefixMessage } = require('../application/handlers/commandHandler');

module.exports = {
  name: Events.MessageCreate,
  async execute(client, message) {
    try {
      await handlePrefixMessage(client, message);

      // ── Automation rule engine ──────────────────────────────────────────────
      if (!message.author?.bot && message.guild) {
        runRules(message.guild.id, 'message', { guild: message.guild, member: message.member, message, client }).catch(() => {});
      }

      // ── AI / rule-based content screening ─────────────────────────────────
      // Fires asynchronously after prefix dispatch — never delays normal flow.
      if (!message.author?.bot && message.guild) {
        const settings = await getGuildSettings(message.guild.id).catch(() => null);
        const aiCfg = settings?.aiMod ?? {};
        if (aiCfg.enabled && aiCfg.alertChannelId) {
          screenMessage(message.content, message.guild.id, aiCfg)
            .then(async (result) => {
              if (!result.flagged) return;
              const alertCh = await message.guild.channels.fetch(aiCfg.alertChannelId).catch(() => null);
              if (!alertCh?.isTextBased?.()) return;
              const emb = buildFlagEmbed(result, message);
              await alertCh.send({ embeds: [emb] }).catch(() => {});
            })
            .catch(() => {});
        }
      }
    } catch (err) {
      logger.error({ err, guildId: message.guild?.id, channelId: message.channelId, userId: message.author?.id }, '[messageCreate] error');
    }
  },
};
