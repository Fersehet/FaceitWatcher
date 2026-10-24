import type { EloAfterMatch, MatchDetails, MatchRecord, PlayerSnapshot, StatsSource } from './types.ts';

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
      avatarFrame: '',
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
        if (!isFinished(m) || !isMatchmaking(m)) continue;
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

  async fetchRecentMatches(playerId: string, count: number, isKnown: (matchId: string) => boolean): Promise<MatchDetails[]> {
    // Mehr laden als nötig, weil Turniere und Ligen herausgefiltert werden
    const history = await this.get<any>(`/players/${playerId}/history?game=${GAME}&offset=0&limit=${count * 4}`);
    const results: MatchDetails[] = [];
    const items = (history.items ?? []).filter((m: any) => isFinished(m) && isMatchmaking(m)).slice(0, count);
    for (const m of items) {
      if (isKnown(m.match_id)) continue;
      const stats = await this.get<any>(`/matches/${m.match_id}/stats`);
      const round = stats.rounds?.[0];
      const players = (round?.teams ?? []).flatMap((t: any) => t.players ?? []);
      const me = players.find((p: any) => p.player_id === playerId);
      if (!round || !me) continue;
      const s = me.player_stats ?? {};
      results.push({
        matchId: m.match_id,
        playerId,
        nickname: me.nickname,
        finishedAt: new Date((num(m.finished_at) ?? Date.now() / 1000) * 1000).toISOString(),
        result: String(s['Result']) === '1' ? 'W' : 'L',
        map: String(round.round_stats?.Map ?? ''),
        score: ownScoreFirst(String(round.round_stats?.Score ?? ''), String(s['Result']) === '1'),
        kills: num(s['Kills']) ?? 0,
        deaths: num(s['Deaths']) ?? 0,
        assists: num(s['Assists']) ?? 0,
        kd: num(s['K/D Ratio']) ?? 0,
        adr: num(s['ADR']),
        hsPercent: num(s['Headshots %']) ?? 0,
        mvps: num(s['MVPs']),
        url: String(m.faceit_url ?? '').replace('{lang}', 'de'),
      });
    }
    return results;
  }

  /**
   * Die offizielle Data API liefert keine Kosmetik. Die Faceit-Webseite lädt den ausgerüsteten
   * Avatar-Rahmen über die interne Schnittstelle /api/user-summary/v2/list (POST {"ids": [...]}).
   * Ändert Faceit diese Schnittstelle, gibt es einfach keinen Rahmen.
   */
  async fetchAvatarFrame(playerId: string): Promise<string> {
    try {
      const res = await fetch('https://www.faceit.com/api/user-summary/v2/list', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 FaceitWatcher' },
        body: JSON.stringify({ ids: [playerId] }),
      });
      if (!res.ok) return '';
      return pickFrameUrl(await res.json());
    } catch {
      return '';
    }
  }

  /**
   * Die Data API liefert keine Elo pro Match. Die Faceit-Webseite zeigt sie im Elo-Verlauf über die interne
   * Schnittstelle /api/stats/v1/stats/time/users/{id}/games/cs2 (Feld "elo" = Stand nach dem Match).
   * Ändert Faceit diese Schnittstelle, bleibt die Elo-Änderung älterer Matches einfach unbekannt.
   */
  async fetchEloHistory(playerId: string, count: number): Promise<EloAfterMatch[]> {
    try {
      const res = await fetch(`https://www.faceit.com/api/stats/v1/stats/time/users/${playerId}/games/${GAME}?page=0&size=${count}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 FaceitWatcher' },
      });
      if (!res.ok) return [];
      const body = await res.json();
      const items: any[] = Array.isArray(body) ? body : (body?.items ?? body?.payload ?? []);
      return items
        .map((m) => ({ matchId: String(m.matchId ?? m.match_id ?? ''), elo: num(m.elo) ?? NaN, at: num(m.date, m.created_at) ?? 0 }))
        .filter((m) => m.matchId && Number.isFinite(m.elo))
        .sort((a, b) => b.at - a.at)
        .map(({ matchId, elo }) => ({ matchId, elo }));
    } catch {
      return [];
    }
  }
}

/**
 * Sucht alle Bild-URLs unter Schlüsseln mit "frame" (z. B. non_animated_frame_large_url, animated_frame_large_url)
 * und nimmt die große Variante, bevorzugt die nicht animierte, die Faceit auch im Profil zeigt.
 */
export function pickFrameUrl(value: unknown): string {
  const found: { key: string; url: string }[] = [];
  const walk = (v: unknown, key: string, depth: number) => {
    if (depth > 10 || v === null) return;
    if (typeof v === 'string') {
      if (/frame/i.test(key) && /^https:\/\/\S+\.(png|webp|gif|svg|apng)(\?\S*)?$/i.test(v)) found.push({ key: key.toLowerCase(), url: v });
      return;
    }
    if (typeof v !== 'object') return;
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) walk(child, Array.isArray(v) ? key : k, depth + 1);
  };
  walk(value, '', 0);
  const score = ({ key }: { key: string }) =>
    (key.includes('large') ? 2 : 0) + (!key.includes('animated') || /non_?animated|static/.test(key) ? 1 : 0);
  return found.sort((a, b) => score(b) - score(a))[0]?.url ?? '';
}

function isFinished(m: any): boolean {
  return !m.status || String(m.status).toUpperCase() === 'FINISHED';
}

/** Nur Matchmaking zählt, keine Turniere (championship) oder Ligen. */
function isMatchmaking(m: any): boolean {
  return !m.competition_type || String(m.competition_type).toLowerCase() === 'matchmaking';
}

/** Faceit liefert den Endstand als "Team 1 / Team 2". Wir zeigen ihn aus Sicht des Spielers: eigene Runden zuerst. */
function ownScoreFirst(score: string, won: boolean): string {
  const rounds = score.split('/').map((p) => Number.parseInt(p.trim(), 10));
  if (rounds.length !== 2 || rounds.some(Number.isNaN)) return score;
  const [high, low] = [Math.max(...rounds), Math.min(...rounds)];
  return won ? `${high} / ${low}` : `${low} / ${high}`;
}
