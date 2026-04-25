const { MessageFlags } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/settings');

function parseIndexes(input, max) {
  const out = new Set();
  const raw = String(input || '').trim();
  if (!raw) return [];

  const parts = raw.split(/\s*,\s*|\s+/).filter(Boolean);
  for (const p of parts) {
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      for (let i = start; i <= end; i++) {
        if (i >= 1 && i <= max) out.add(i);
      }
      continue;
    }
    const n = Number(p);
    if (Number.isInteger(n) && n >= 1 && n <= max) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

module.exports = {
  id: 'rolepanelOptionDelete',

  async execute(interaction) {
    // Modal submits must be acknowledged quickly; defer to avoid "Unknown interaction" (10062)
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }

    const guildId = interaction.guildId;
    const settings = await getGuildSettings(guildId);
    const panel = settings?.rolePanel?.panel ?? {};
    const options = Array.isArray(panel.options) ? panel.options : [];

    if (!options.length) {
      return interaction.editReply({ content: 'No role options configured yet.' });
    }

    const raw = interaction.fields.getTextInputValue('indexes');
    const idxs = parseIndexes(raw, options.length);
    if (!idxs.length) {
      return interaction.editReply({ content: 'Invalid numbers. Example: `2` or `1,3,5` or `2-4`.' });
    }

    const toDelete = new Set(idxs.map((i) => i - 1));
    const removed = options.filter((_, i) => toDelete.has(i));
    const next = options.filter((_, i) => !toDelete.has(i));

    await setGuildSettings(guildId, { rolePanel: { panel: { options: next } } });

    const removedText = removed
      .slice(0, 10)
      .map((o) => `<@&${o.roleId}>`)
      .join(', ');

    return interaction.editReply({
      content: `✅ Deleted **${removed.length}** option(s).${removed.length ? ` Removed: ${removedText}${removed.length > 10 ? '…' : ''}` : ''}`,
    });
  },
};
