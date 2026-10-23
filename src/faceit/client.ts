import type { MatchRecord, PlayerSnapshot, StatsSource } from './types.ts';

const BASE_URL = 'https://open.faceit.com/data/v4';
const GAME = 'cs2';

type Lifetime = Record<string, unknown>;

function num(...values: unknown[]): number | null {
  for (const v of values) {
    const n = typeof v === 'number' ? v : Number(v);
    if (v !== undefined && v !== null && v !== '' && Number.isFinite(n)) return n;
  }
  return null;
}

/** Zugriff auf die offizielle Faceit Data API v4. */
export class FaceitClient implements StatsSource {
  readonly demo = false;

  constructor(private readonly apiKey: string) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(BASE_URL + path, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' },
    });
    if (res.status === 401 || res.status === 403) throw new Error('Faceit API-Key ungültig oder ohne Berechtigung');
    if (res.status === 404) throw new Error('Spieler nicht gefunden');
    if (res.status === 429) throw new Error('Faceit Rate-Limit erreicht, bitte Abfrage-Intervall erhöhen');
    if (!res.ok) throw new Error(`Faceit API Fehler ${res.status}`);
    return (await res.json()) as T;
  }

  async fetchPlayer(nickname: string): Promise<PlayerSnapshot> {
    const player = await this.get<any>(`/players?nickname=${encodeURIComponent(nickname)}&game=${GAME}`);
    const game = player.games?.[GAME];
    if (!game) throw new Error(`${player.nickname} hat kein CS2-Profil auf Faceit`);

    const stats = await this.get<any>(`/players/${player.player_id}/stats/${GAME}`);
    const l: Lifetime = stats.lifetime ?? {};

    const matches = num(l['Matches'], l['Total Matches']) ?? 0;
    const winRate = num(l['Win Rate %']) ?? 0;
    const recent = Array.isArray(l['Recent Results']) ? (l['Recent Results'] as unknown[]) : [];

    return {
      playerId: player.player_id,
      nickname: player.nickname,
      avatar: player.avatar ?? '',
      country: player.country ?? '',
      elo: num(game.faceit_elo) ?? 0,
      level: num(game.skill_level) ?? 1,
      matches,
      wins: num(l['Wins']) ?? Math.round((matches * winRate) / 100),
      winRate,
      kd: num(l['Average K/D Ratio'], l['K/D Ratio']) ?? 0,
      hsPercent: num(l['Average Headshots %'], l['Total Headshots %']) ?? 0,
      adr: num(l['ADR'], l['Average ADR']),
      currentStreak: num(l['Current Win Streak']) ?? 0,
      longestStreak: num(l['Longest Win Streak']) ?? 0,
      recentResults: recent.map((r) => (String(r) === '1' ? 'W' : 'L')),
      fetchedAt: new Date().toISOString(),
    };
  }

  async fetchRecordSince(playerId: string, since: Date): Promise<MatchRecord> {
    const from = Math.floor(since.getTime() / 1000);
    const pageSize = 100;
    let matches = 0;
    let wins = 0;
    // Höchstens 20 Seiten (2000 Matches), damit das Rate-Limit nicht gesprengt wird
    for (let offset = 0; offset < 2000; offset += pageSize) {
      const page = await this.get<any>(
        `/players/${playerId}/history?game=${GAME}&from=${from}&offset=${offset}&limit=${pageSize}`,
      );
      const items: any[] = page.items ?? [];
      for (const m of items) {
        if (m.status && String(m.status).toUpperCase() !== 'FINISHED') continue;
        const winner = m.results?.winner;
        const team = Object.entries(m.teams ?? {}).find(([, t]: [string, any]) =>
          (t.players ?? []).some((p: any) => p.player_id === playerId),
        )?.[0];
        if (!winner || !team) continue;
        matches += 1;
        if (team === winner) wins += 1;
      }
      if (items.length < pageSize) break;
    }
    return { matches, wins };
  }
}
