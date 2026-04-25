const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { requireModLog, createAndSendCase } = require('../../utils/modLogService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member for a specified duration.')
    .addUserOption((o) => o.setName('user').setDescription('Member to timeout').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('Duration (e.g. 30s, 5m, 2h, 1d)').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const modLogCh = await requireModLog(interaction);
    if (!modLogCh) return;

    const user = interaction.options.getUser('user', true);
    const durationRaw = interaction.options.getString('duration', true);
    const reason = interaction.options.getString('reason') ?? 'None';

    const durationMs = parseDuration(durationRaw);
    if (!durationMs) {
      return interaction.editReply('❌ Invalid duration. Use formats like `30s`, `5m`, `2h`, `1d`.');
    }

    const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
    if (durationMs > MAX_TIMEOUT_MS) {
      return interaction.editReply('❌ Duration is too long. Max timeout is 28 days.');
    }

    if (user.id === interaction.user.id) {
      return interaction.editReply('❌ You can’t timeout yourself.');
    }

    const me = await interaction.guild.members.fetchMe();
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.editReply('❌ That user is not in this server.');

    // Role hierarchy checks
    if (interaction.member?.roles?.highest && member.roles.highest.position >= interaction.member.roles.highest.position) {
      return interaction.editReply('❌ You can’t timeout someone with an equal/higher role than you.');
    }
    if (me.roles.highest.position <= member.roles.highest.position) {
      return interaction.editReply('❌ My role must be higher than the target’s highest role.');
    }

    await member.timeout(durationMs, reason).catch((e) => {
      throw e;
    });

    const c = await createAndSendCase({
      guild: interaction.guild,
      type: 'timeout',
      title: '⏳ Timeout',
      moderator: interaction.user,
      target: user,
      reason,
      fields: [{ name: 'Duration', value: formatDuration(durationMs), inline: true }],
      durationMs,
      dmTarget: true,
    });

    await interaction.editReply(`⏳ Timed out **${user.tag}** for **${formatDuration(durationMs)}**. Reason: ${reason}${c ? ` | Case: #${c.id}` : ''}`);
},
};
