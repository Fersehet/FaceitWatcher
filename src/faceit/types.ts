/** Normalisierter Stand eines Spielers, unabhängig davon, ob er von Faceit oder aus dem Demo-Modus kommt. */
export interface PlayerSnapshot {
  playerId: string;
  nickname: string;
  avatar: string;
  country: string;
  elo: number;
  level: number;
  matches: number;
  wins: number;
  winRate: number;
  kd: number;
  hsPercent: number;
  adr: number | null;
  currentStreak: number;
  longestStreak: number;
  recentResults: ('W' | 'L')[];
  fetchedAt: string;
}

export interface StatsSource {
  readonly demo: boolean;
  fetchPlayer(nickname: string): Promise<PlayerSnapshot>;
}

/** Faceit CS2 Level-Grenzen (Mindest-Elo pro Level). */
export const LEVEL_THRESHOLDS = [0, 501, 751, 901, 1051, 1201, 1351, 1531, 1751, 2001];

export function levelForElo(elo: number): number {
  let level = 1;
  LEVEL_THRESHOLDS.forEach((min, i) => {
    if (elo >= min) level = i + 1;
  });
  return level;
}
