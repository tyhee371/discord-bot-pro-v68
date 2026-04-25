const {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');

const { getGuildSettings } = require('../../utils/settings');

module.exports = {
  // Handles:
  //   rolepanel:list:edit      -> modal to edit an option by index
  //   rolepanel:list:remove    -> modal to remove an option by index (legacy single panel)
  //   rolepanel:edit           -> modal to edit the panel embed (legacy / builder preview)
  //   rolepanel:toggle:<roleId>-> toggle a role (button-style panels)
  id: 'rolepanel',

  async execute(interaction) {
    const cid = String(interaction.customId || '');

    // ── list:edit / list:remove (legacy single-panel list) ───────────────────
    if (cid === 'rolepanel:list:edit' || cid === 'rolepanel:list:remove') {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || !member.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({ content: '\u274c You need **Manage Roles** to do that.', flags: MessageFlags.Ephemeral });
      }

      const act = cid.endsWith(':edit') ? 'edit' : 'remove';
      const modal = new ModalBuilder()
        .setCustomId(`rolepanelList:${act}`)
        .setTitle(act === 'remove' ? 'Remove Role Option' : 'Edit Role Option');

      const builderId = new TextInputBuilder()
        .setCustomId('builder_id').setLabel('Builder ID').setStyle(TextInputStyle.Short)
        .setRequired(true).setPlaceholder('Builder id from /rolepanel builder-list');

      const index = new TextInputBuilder()
        .setCustomId('index').setLabel('Option number (from /rolepanel list)').setStyle(TextInputStyle.Short)
        .setRequired(true).setPlaceholder('e.g. 1');

      modal.addComponents(new ActionRowBuilder().addComponents(builderId), new ActionRowBuilder().addComponents(index));

      if (act === 'edit') {
        const label = new TextInputBuilder()
          .setCustomId('label').setLabel('New label (leave blank to keep)').setStyle(TextInputStyle.Short).setRequired(false);
        const description = new TextInputBuilder()
          .setCustomId('description').setLabel('New description (leave blank to keep)').setStyle(TextInputStyle.Paragraph).setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(label), new ActionRowBuilder().addComponents(description));
      }

      return interaction.showModal(modal);
    }

    // ── edit panel embed ──────────────────────────────────────────────────────
    if (cid === 'rolepanel:edit' || cid === 'rolePanel:edit') {
      const settings = await getGuildSettings(interaction.guildId);
      // For legacy single-panel, open the first builder's embed editor
      const builders = settings?.rolePanel?.builders ?? {};
      const ids = Object.keys(builders);
      const builderId = ids.length === 1 ? ids[0] : 'default';
      // Redirect to rolepanelPanel:edit:<builderId> logic by faking the customId
      interaction.customId = `rolepanelPanel:edit:${builderId}`;
      const rolepanelPanelHandler = require('./rolepanelPanel');
      return rolepanelPanelHandler.execute(interaction);
    }

    // ── toggle role (button-style sent panel) ─────────────────────────────────
    const parts = cid.split(':');
    if (parts[0] !== 'rolepanel' || parts[1] !== 'toggle') return;

    const roleId = parts[2];
    if (!roleId) return;

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return interaction.reply({ content: '\u274c Could not load your member info.', flags: MessageFlags.Ephemeral });

    const me = await interaction.guild.members.fetchMe().catch(() => interaction.guild.members.me);
    if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: '\u274c I need **Manage Roles** to update roles.', flags: MessageFlags.Ephemeral });
    }

    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) return interaction.reply({ content: '\u26a0\ufe0f That role no longer exists.', flags: MessageFlags.Ephemeral });
    if (role.managed) return interaction.reply({ content: '\u26a0\ufe0f That role is managed and cannot be assigned.', flags: MessageFlags.Ephemeral });
    if (role.position >= me.roles.highest.position) {
      return interaction.reply({ content: '\u26a0\ufe0f That role is higher than my highest role.', flags: MessageFlags.Ephemeral });
    }

    const has = member.roles.cache.has(roleId);
    if (has) {
      await member.roles.remove(roleId).catch(() => null);
      return interaction.reply({ content: `\ud83d\uddd1\ufe0f Removed ${role}.`, flags: MessageFlags.Ephemeral });
    }
    await member.roles.add(roleId).catch(() => null);
    return interaction.reply({ content: `\u2705 Added ${role}.`, flags: MessageFlags.Ephemeral });
  },
};
