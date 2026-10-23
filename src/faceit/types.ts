/** Normalisierter Stand eines Spielers, unabhängig davon, ob er von Faceit oder aus dem Demo-Modus kommt. */
export interface PlayerSnapshot {
  playerId: string;
  nickname: string;
  avatar: string;
  /** Bild-URL des ausgerüsteten Faceit-Avatar-Rahmens, leer = keiner gefunden */
  avatarFrame: string;
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

export interface MatchRecord {
  matches: number;
  wins: number;
}

/** Ein abgeschlossenes Match aus Sicht des getrackten Spielers. Wird gespeichert und an Overlay und Discord-Bot verteilt. */
export interface MatchResult {
  matchId: string;
  playerId: string;
  nickname: string;
  avatar: string;
  avatarFrame: string;
  finishedAt: string;
  result: 'W' | 'L';
  map: string;
  score: string;
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  adr: number | null;
  hsPercent: number;
  mvps: number | null;
  /** Elo-Werte sind nur beim neuesten Match eines Abrufs bekannt, sonst null. */
  eloBefore: number | null;
  eloAfter: number | null;
  eloChange: number | null;
  level: number;
  url: string;
}

export type MatchDetails = Omit<MatchResult, 'avatar' | 'avatarFrame' | 'eloBefore' | 'eloAfter' | 'eloChange' | 'level'>;

export interface StatsSource {
  readonly demo: boolean;
  fetchPlayer(nickname: string): Promise<PlayerSnapshot>;
  /** Siege und Matches seit einem Zeitpunkt (z. B. Season-Start). */
  fetchRecordSince(playerId: string, since: Date): Promise<MatchRecord>;
  /** Die letzten `count` Matches, neueste zuerst. Details werden nur für Matches geladen, die `isKnown` nicht kennt. */
  fetchRecentMatches(playerId: string, count: number, isKnown: (matchId: string) => boolean): Promise<MatchDetails[]>;
  /** Bild-URL des Avatar-Rahmens oder '' (nicht Teil der offiziellen Data API, daher Best-Effort). */
  fetchAvatarFrame(nickname: string): Promise<string>;
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
