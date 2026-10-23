import type { Embed } from './discord.ts';
import type { MatchResult as ServerMatch } from '../faceit/types.ts';

const GREEN = 0x22c55e;
const RED = 0xef4444;

/** "de_mirage" → "Mirage" */
export function mapName(map: string): string {
  const name = map.replace(/^(de|cs|ar)_/i, '').replace(/_/g, ' ');
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Unbekannte Map';
}

function eloText(m: ServerMatch): string {
  if (m.eloChange === null) return m.eloAfter !== null ? `? → ${m.eloAfter}` : 'unbekannt';
  const sign = m.eloChange > 0 ? '+' : m.eloChange < 0 ? '−' : '±';
  const after = m.eloAfter !== null ? ` → ${m.eloAfter}` : '';
  return `**${sign}${Math.abs(m.eloChange)}**${after}`;
}

export function matchEmbed(m: ServerMatch): Embed {
  const won = m.result === 'W';
  const fields: Embed['fields'] = [
    { name: 'Ergebnis', value: m.score || '?', inline: true },
    { name: 'Elo', value: eloText(m), inline: true },
    { name: 'Level', value: String(m.level), inline: true },
    { name: 'K / D / A', value: `${m.kills} / ${m.deaths} / ${m.assists}`, inline: true },
    { name: 'K/D', value: m.kd.toFixed(2), inline: true },
    { name: 'ADR', value: m.adr !== null ? m.adr.toFixed(1) : '–', inline: true },
    { name: 'HS %', value: `${Math.round(m.hsPercent)}%`, inline: true },
  ];
  if (m.mvps !== undefined && m.mvps !== null) fields.push({ name: 'MVPs', value: String(m.mvps), inline: true });

  return {
    author: { name: m.nickname, url: `https://www.faceit.com/de/players/${encodeURIComponent(m.nickname)}`, icon_url: m.avatar || undefined },
    title: `${won ? '🟢 Sieg' : '🔴 Niederlage'} auf ${mapName(m.map)}`,
    url: m.url || undefined,
    color: won ? GREEN : RED,
    fields,
    footer: { text: 'FaceitWatcher' },
    timestamp: m.finishedAt,
  };
}
