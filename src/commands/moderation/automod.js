const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  AutoModerationActionType,
} = require('discord.js');

const { getGuildSettings, setGuildSettings } = require('../../utils/settings');

async function ensureAlertChannel(interaction) {
  const settings = await getGuildSettings(interaction.guildId);
  const alertChannelId = settings?.automod?.alertChannelId;
  if (!alertChannelId) return null;
  return interaction.guild.channels.fetch(alertChannelId).catch(() => null);
}

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Manage Discord AutoMod rules.')
    .addSubcommand(s =>
      s.setName('set-alert-channel')
        .setDescription('Set channel where AutoMod alerts will be logged.')
        .addChannelOption(o => o.setName('channel').setDescription('Alert channel').setRequired(true)),
    )
    .addSubcommand(s =>
      s.setName('setup')
        .setDescription('Create common AutoMod rules (spam + mention limit).')
        .addIntegerOption(o =>
          o.setName('mention_limit')
            .setDescription('Max mentions per message (default 5).')
            .setMinValue(1)
            .setMaxValue(50)
            .setRequired(false),
        ),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const settings = await getGuildSettings(interaction.guildId);

    if (sub === 'set-alert-channel') {
      const channel = interaction.options.getChannel('channel', true);
      await setGuildSettings(interaction.guildId, { automod: { alertChannelId: channel.id } });
      return interaction.editReply(`✅ AutoMod alert channel set to ${channel}.`);
    }

    if (sub === 'setup') {
      const alertChannel = await ensureAlertChannel(interaction);
      const mentionLimit = interaction.options.getInteger('mention_limit') ?? 5;

      const spamRule = await interaction.guild.autoModerationRules.create({
        name: 'Anti-spam (bot)',
        eventType: AutoModerationRuleEventType.MessageSend,
        triggerType: AutoModerationRuleTriggerType.Spam,
        actions: [
          { type: AutoModerationActionType.BlockMessage, metadata: { customMessage: 'Please stop spamming.' } },
          ...(alertChannel ? [{ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: alertChannel.id } }] : []),
        ],
        enabled: true,
        reason: `Setup by ${interaction.user.tag}`,
      });

      const mentionRule = await interaction.guild.autoModerationRules.create({
        name: `Mention limit (${mentionLimit}) (bot)`,
        eventType: AutoModerationRuleEventType.MessageSend,
        triggerType: AutoModerationRuleTriggerType.MentionSpam,
        triggerMetadata: { mentionTotalLimit: mentionLimit },
        actions: [
          { type: AutoModerationActionType.BlockMessage, metadata: { customMessage: 'Too many mentions in one message.' } },
          ...(alertChannel ? [{ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: alertChannel.id } }] : []),
        ],
        enabled: true,
        reason: `Setup by ${interaction.user.tag}`,
      });

      await setGuildSettings(interaction.guildId, {
        automod: { rules: { spamRuleId: spamRule.id, mentionRuleId: mentionRule.id } },
      });

      return interaction.editReply(
        `✅ AutoMod rules created:\n• Spam rule: \`${spamRule.id}\`\n• Mention limit rule: \`${mentionRule.id}\` (limit ${mentionLimit})`,
      );
    }

    // fallback
    return interaction.editReply(`Unknown subcommand.`);
  },
};
