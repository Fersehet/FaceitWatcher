import { levelForElo, type MatchRecord, type PlayerSnapshot, type StatsSource } from './types.ts';

/**
 * Liefert erfundene Daten, solange kein API-Key eingetragen ist.
 * Bei jeder Abfrage wird mit 50 % Wahrscheinlichkeit ein Match "gespielt",
 * damit Live-Updates im Overlay sichtbar werden.
 */
export class DemoSource implements StatsSource {
  readonly demo = true;

  private elo = 1985;
  private matches = 642;
  private wins = 351;
  private streak = 2;
  private longest = 9;
  private recent: ('W' | 'L')[] = ['W', 'W', 'L', 'W', 'L'];

  async fetchPlayer(nickname: string): Promise<PlayerSnapshot> {
    if (Math.random() < 0.5) this.playMatch();

    return {
      playerId: 'demo-player',
      nickname: nickname || 'DemoPlayer',
      avatar: '',
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
    return { matches: this.matches - 602, wins: this.wins - 329 };
  }

  private playMatch() {
    const won = Math.random() < 0.55;
    const delta = 20 + Math.floor(Math.random() * 10);
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
  }
}
