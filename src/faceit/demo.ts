import { levelForElo, type MatchDetails, type MatchRecord, type PlayerSnapshot, type StatsSource } from './types.ts';

/**
 * Liefert erfundene Daten, solange kein API-Key eingetragen ist.
 * Bei jeder Abfrage wird mit 50 % Wahrscheinlichkeit ein Match "gespielt",
 * damit Live-Updates im Overlay sichtbar werden. Etwa jedes fünfte ist ein Hub-Match ohne Elo.
 */
export class DemoSource implements StatsSource {
  readonly demo = true;

  private elo = 1985;
  private matches = 642;
  private wins = 351;
  private streak = 2;
  private longest = 9;
  private recent: ('W' | 'L')[] = ['W', 'W', 'L', 'W', 'L'];
  private played: MatchDetails[] = [];

  async fetchPlayer(nickname: string): Promise<PlayerSnapshot> {
    if (Math.random() < 0.5) this.playMatch();

    return {
      playerId: 'demo-player',
      nickname: nickname || 'DemoPlayer',
      avatar: '',
      avatarFrame: '',
      country: 'de',
      elo: this.elo,
      level: levelForElo(this.elo),
      matches: this.matches,
      wins: this.wins,
      winRate: Math.round((this.wins / this.matches) * 100),
      kd: 1.18,
      hsPercent: 48,
      adr: 82.4,
      currentStreak: this.streak,
      longestStreak: this.longest,
      recentResults: [...this.recent],
      fetchedAt: new Date().toISOString(),
    };
  }

  async fetchRecordSince(): Promise<MatchRecord> {
    // Demo: die Season begann vor 40 Matches mit 22 Siegen Rückstand zum Lifetime-Stand
    return { matches: this.matches - 602, wins: this.wins - 329, kd: 1.24, hsPercent: 51, adr: 85.7 };
  }

  async fetchRecentMatches(_playerId: string, count: number, isKnown: (matchId: string) => boolean): Promise<MatchDetails[]> {
    return this.played.slice(0, count).filter((m) => !isKnown(m.matchId));
  }

  async fetchAvatarFrame(): Promise<string> {
    return '';
  }

  private playMatch() {
    const won = Math.random() < 0.55;
    // Hubs, Turniere und Ligen zählen in allen Stats mit, bringen aber keine Elo
    const ranked = Math.random() >= 0.2;
    const delta = ranked ? 20 + Math.floor(Math.random() * 10) : 0;
    this.matches += 1;
    if (won) {
      this.wins += 1;
      this.elo += delta;
      this.streak += 1;
      this.longest = Math.max(this.longest, this.streak);
    } else {
      this.elo -= delta;
      this.streak = 0;
    }
    this.recent = [won ? ('W' as const) : ('L' as const), ...this.recent].slice(0, 5);

    const maps = ['de_mirage', 'de_inferno', 'de_nuke', 'de_ancient', 'de_anubis', 'de_dust2', 'de_train'];
    const kills = 10 + Math.floor(Math.random() * 20);
    const deaths = 10 + Math.floor(Math.random() * 15);
    const lost = 3 + Math.floor(Math.random() * 9);
    const id = `demo-${this.matches}`;
    this.played.unshift({
      matchId: id,
      playerId: 'demo-player',
      nickname: 'DemoPlayer',
      finishedAt: new Date().toISOString(),
      result: won ? 'W' : 'L',
      map: maps[Math.floor(Math.random() * maps.length)],
      score: won ? `13 / ${lost}` : `${lost} / 13`,
      kills,
      deaths,
      assists: Math.floor(Math.random() * 8),
      kd: Math.round((kills / deaths) * 100) / 100,
      adr: Math.round((60 + Math.random() * 50) * 10) / 10,
      hsPercent: 30 + Math.floor(Math.random() * 35),
      mvps: Math.floor(Math.random() * 6),
      matchMvp: Math.random() < 0.3,
      ranked,
      url: `https://www.faceit.com/de/cs2/room/${id}`,
    });
    this.played = this.played.slice(0, 20);
  }
}
