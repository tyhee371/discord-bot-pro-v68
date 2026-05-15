const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireModLogStrict: requireModLog, createAndSendCase } = require('../../utils/modLogService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user.')
    .addUserOption(o => o.setName('user').setDescription('User to ban').setRequired(true))
    .addIntegerOption(o =>
      o.setName('delete_hours')
        .setDescription('Delete their messages from the last N hours (0-168).')
        .setMinValue(0)
        .setMaxValue(168)
        .setRequired(false),
    )
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const modLogCh = await requireModLog(interaction);
    if (!modLogCh) return;

    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? 'None';
    const deleteHours = interaction.options.getInteger('delete_hours') ?? 0;

    if (user.id === interaction.user.id) {
      return interaction.editReply('You can’t ban yourself.');
    }

    const me = await interaction.guild.members.fetchMe();
    const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (targetMember) {
      if (!targetMember.bannable) return interaction.editReply('I can’t ban that member (role hierarchy / missing perms).');

      if (interaction.member?.roles?.highest && targetMember.roles.highest.position >= interaction.member.roles.highest.position) {
        return interaction.editReply('You can’t ban someone with an equal/higher role than you.');
      }
      if (me.roles.highest.position <= targetMember.roles.highest.position) {
        return interaction.editReply('My role must be higher than the target’s highest role.');
      }
    }

    const deleteMessageSeconds = deleteHours * 60 * 60;

    await interaction.guild.bans.create(user.id, {
      reason,
      deleteMessageSeconds: deleteMessageSeconds || undefined,
    });

    const c = await createAndSendCase({
      guild: interaction.guild,
      type: 'ban',
      title: '🔨 Ban',
      moderator: interaction.user,
      target: user,
      reason,
      fields: [{ name: 'Delete messages', value: `${deleteHours}h`, inline: true }],
      dmTarget: true,
      extra: { deleteHours },
    });

    await interaction.editReply(`✅ Banned **${user.tag}**. Reason: ${reason}${c ? ` | Case: #${c.id}` : ''}`);
  },
};
