const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireModLogStrict: requireModLog, createAndSendCase } = require('../../utils/modLogService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member.')
    .addUserOption(o => o.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async execute(interaction) {
    const modLogCh = await requireModLog(interaction);
    if (!modLogCh) return;

    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? 'None';

    if (user.id === interaction.user.id) return interaction.editReply('You can’t kick yourself.');

    const me = await interaction.guild.members.fetchMe();
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.editReply('That user is not in this server.');
    if (!member.kickable) return interaction.editReply('I can’t kick that member (role hierarchy / missing perms).');

    if (interaction.member?.roles?.highest && member.roles.highest.position >= interaction.member.roles.highest.position) {
      return interaction.editReply('You can’t kick someone with an equal/higher role than you.');
    }
    if (me.roles.highest.position <= member.roles.highest.position) {
      return interaction.editReply('My role must be higher than the target’s highest role.');
    }

    await member.kick(reason);
    const c = await createAndSendCase({
      guild: interaction.guild,
      type: 'kick',
      title: '🥾 Kick',
      moderator: interaction.user,
      target: user,
      reason,
      dmTarget: true,
    });

    await interaction.editReply(`✅ Kicked **${user.tag}**. Reason: ${reason}${c ? ` | Case: #${c.id}` : ''}`);
},
};
