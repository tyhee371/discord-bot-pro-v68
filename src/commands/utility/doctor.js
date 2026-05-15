const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { generateDependencyReport } = require('@discordjs/voice');
const { getGuildSettings } = require('../../utils/settings');
const { getModules } = require('../../utils/modules');
const { getYtDlpVersion, parseYtDlpVersionDate } = require('../../utils/ytDlp');
const { safeReply } = require('../../utils/safeReply');
const { logger } = require('../../utils/logger');
const { validateConfig, formatValidationResults } = require('../../helpers/configValidator');
const { getCriticalNamespaces } = require('../../app/storageManifest');
const fs = require('node:fs');
const path = require('node:path');

function daysAgo(d) {
  const ms = Date.now() - d.getTime();
  return Math.floor(ms / 86400000);
}

function yesNo(v) {
  return v ? '✅ Yes' : '❌ No';
}

function safeText(s, max = 1024) {
  const t = String(s ?? '');
  return t.length > max ? t.slice(0, max - 3) + '...' : t;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('doctor')
    .setDescription('Health + config checks (voice / yt-dlp / permissions / modules).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  ephemeral: true,
  async execute(interaction) {
    try {
      const guild = interaction.guild;
      const settings = await getGuildSettings(interaction.guildId);
      const modules = await getModules(interaction.guildId);

      const me = guild?.members?.me ?? (guild ? await guild.members.fetchMe().catch(() => null) : null);
      const perms = me?.permissions;

      const issues = [];
      const tips = [];

      // ---- Permissions checks
      const need = [
        ['View Audit Log', PermissionFlagsBits.ViewAuditLog],
        ['Send Messages', PermissionFlagsBits.SendMessages],
        ['Embed Links', PermissionFlagsBits.EmbedLinks],
        ['Read Message History', PermissionFlagsBits.ReadMessageHistory],
      ];
      for (const [name, bit] of need) {
        if (perms && !perms.has(bit)) issues.push(`Missing bot permission: **${name}**`);
      }

      // Ticket role hierarchy check (if configured)
      const ticket = settings.ticket ?? settings.tickets ?? {};
      const adminRoleId = ticket.adminRoleId;
      const modRoleId = ticket.modRoleId;
      if (adminRoleId || modRoleId) {
        const botTop = me?.roles?.highest?.position ?? 0;
        for (const rid of [adminRoleId, modRoleId].filter(Boolean)) {
          const role = guild?.roles?.cache?.get(rid);
          if (!role) issues.push(`Ticket role not found (ID): **${rid}**`);
          else if (botTop <= role.position) issues.push(`Bot role must be ABOVE **${role.name}** to manage ticket permissions.`);
        }
      }

      // ---- Module toggles
      const disabled = Object.entries(modules).filter(([, v]) => !v).map(([k]) => k);
      if (disabled.length) tips.push(`Disabled modules: ${disabled.map((x) => `\`${x}\``).join(', ')}`);

      // ---- yt-dlp
      const yt = await getYtDlpVersion().catch(() => null);
      if (!yt) {
        issues.push('yt-dlp not found. Put **yt-dlp.exe** in `/bin` or install it globally.');
      } else {
        const d = parseYtDlpVersionDate(yt);
        if (d) {
          const age = daysAgo(d);
          if (age > 30) tips.push(`yt-dlp is **${age} days old**. Update monthly to avoid YouTube 403.`);
        }
      }

      // ---- voice deps
      const dep = generateDependencyReport();
      const hasOpus = dep.includes('@discordjs/opus:') && !dep.includes('@discordjs/opus: not found');
      if (!hasOpus && dep.includes('opusscript:')) {
        tips.push('Using **opusscript** (OK). If music is unstable, consider using a prebuilt opus lib later.');
      }

      // ---- lockfile check
      const lockPath = path.join(process.cwd(), 'package-lock.json');
      if (!fs.existsSync(lockPath)) {
        tips.push('No **package-lock.json** found. Run: `npm install --package-lock-only` then commit it for stable installs.');
      }

      const emb = new EmbedBuilder()
        .setTitle('🩺 Doctor Report')
        .setDescription('Checks: permissions, modules, yt-dlp, voice deps, stability.')
        .addFields(
          { name: 'Modules', value: safeText(Object.entries(modules).map(([k, v]) => `${k}:${v ? 'on' : 'off'}`).join(' | '), 1024) },
          { name: 'yt-dlp', value: safeText(yt ?? 'not found', 1024), inline: true },
          { name: 'Voice deps', value: safeText(dep.split('\n').slice(0, 8).join('\n'), 1024), inline: true },
        )
        .setTimestamp();

      if (issues.length) emb.addFields({ name: `❌ Issues (${issues.length})`, value: safeText(issues.map((x) => `• ${x}`).join('\n'), 1024) });
      else emb.addFields({ name: '✅ Issues', value: 'None found.' });

      if (tips.length) emb.addFields({ name: '💡 Suggestions', value: safeText(tips.map((x) => `• ${x}`).join('\n'), 1024) });

      // Attach full dependency report
      const file = new AttachmentBuilder(Buffer.from(dep, 'utf-8'), { name: 'voice-deps.txt' });

      // ── Storage namespace diagnostics ───────────────────────────────────
      try {
        const criticalNs = getCriticalNamespaces();
        const nsLines = criticalNs.map((ns) => `\`${ns.prefix}\` — ${ns.description}`).join('\n');
        emb.addFields({ name: '🗄️ Critical Storage Namespaces', value: nsLines.slice(0, 1024) || 'None', inline: false });
      } catch {}

      // ── Config validation ──────────────────────────────────────────────
      try {
        const validationResults = await validateConfig(guild, settings);
        const { fields, summary } = formatValidationResults(validationResults);
        const configEmbed = new EmbedBuilder()
          .setTitle('⚙️ Configuration Health Check')
          .setDescription(summary)
          .addFields(fields.slice(0, 25));
        return safeReply(interaction, { embeds: [emb, configEmbed], files: [file], ephemeral: true });
      } catch (cfgErr) {
        logger.warn({ err: cfgErr }, '[doctor] configValidator failed');
      }

      return safeReply(interaction, { embeds: [emb], files: [file], ephemeral: true });
    } catch (e) {
      logger.error({ err: e }, 'Doctor failed');
      return safeReply(interaction, { content: '⚠️ Doctor failed. Check console.', ephemeral: true });
    }
  },
};
