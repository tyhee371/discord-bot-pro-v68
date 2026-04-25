const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { getGuildSettings } = require('../../utils/settings');

module.exports = {
  id: 'verify',
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: 'This button only works in a server.', flags: MessageFlags.Ephemeral });
    }

    const settings = await getGuildSettings(guild.id);
    const v = settings.verify ?? {};
    if (!v.enabled || !v.roleId) {
      return interaction.reply({ content: 'Verification is not enabled.', flags: MessageFlags.Ephemeral });
    }

    // Optional safety: ensure this is the configured message
    if (v.messageId && interaction.message?.id && interaction.message.id !== v.messageId) {
      return interaction.reply({ content: 'Unknown/expired button.', flags: MessageFlags.Ephemeral });
    }

    const role = guild.roles.cache.get(v.roleId) ?? (await guild.roles.fetch(v.roleId).catch(() => null));
    if (!role) {
      return interaction.reply({ content: 'Verification role not found. Ask staff to re-run `/verify setup`.', flags: MessageFlags.Ephemeral });
    }

    const member = interaction.member;
    if (!member?.roles) {
      return interaction.reply({ content: 'Could not resolve your member profile.', flags: MessageFlags.Ephemeral });
    }

    const me = await guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: 'I need **Manage Roles** permission to do that.', flags: MessageFlags.Ephemeral });
    }
    if (me.roles.highest.comparePositionTo(role) <= 0) {
      return interaction.reply({ content: `My highest role must be **above** ${role} in role list.`, flags: MessageFlags.Ephemeral });
    }

    if (member.roles.cache.has(role.id)) {
      return interaction.reply({ content: `✅ You are already verified (${role}).`, flags: MessageFlags.Ephemeral });
    }

    await member.roles.add(role, 'User verified via /verify').catch(() => null);

    return interaction.reply({ content: `✅ Verified! You now have access (${role}).`, flags: MessageFlags.Ephemeral });
  },
};
