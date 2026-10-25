import { EventEmitter } from 'node:events';
import { LEVEL_THRESHOLDS, type MatchResult, type PlayerSnapshot, type RecentMatch, type StatsSource } from './faceit/types.ts';
import type { Storage } from './storage/storage.ts';

/** Beginn der aktuellen FACEIT-Season (Season 9), solange im Editor kein eigenes Datum gesetzt ist. */
const DEFAULT_SEASON_START = '2026-08-05';

export interface Session {
  /** Gehört die Session zu einem anderen Spieler (z. B. Demo → echter Account), wird neu gestartet. */
  playerId?: string;
  startedAt: string;
  startElo: number;
  startMatches: number;
  startWins: number;
}

export interface SessionStats {
  startedAt: string;
  eloChange: number;
  matches: number;
  wins: number;
  losses: number;
}

export interface SeasonStats {
  start: string;
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
}

/** Ein Punkt im Elo-Verlauf: Stand nach dem Match (der erste Punkt ist der Stand davor, ohne Match). */
export interface EloChartPoint {
  matchId: string;
  finishedAt: string;
  result: 'W' | 'L' | null;
  map: string;
  elo: number;
  change: number;
  /** Elo-Änderung geschätzt statt gemessen oder eingetragen */
  estimated: boolean;
}

/** Auswertung für den Statistik-Tab im Editor, nur aus gespeicherten Matchmaking-Matches. */
export interface StatsOverview {
  elo: number;
  level: number;
  /** Nächstes Level und fehlende Elo, null auf Level 10 */
  nextLevel: { level: number; elo: number; missing: number } | null;
  /** Ältester Punkt zuerst */
  history: EloChartPoint[];
  matches: number;
  change: number;
  peak: number;
  low: number;
  avgPerMatch: number;
  season:
    | (SeasonStats & {
        /** Elo-Änderung seit dem ersten gespeicherten Stand in der Season, null = noch keiner */
        eloChange: number | null;
        /** Ab hier gibt es eigene Daten (erster Stand in der Season), z. B. später als der Season-Start */
        trackedSince: string | null;
        /** Gespeicherte Matches in der Season, Grundlage für K/D und beste Map */
        trackedMatches: number;
        kd: number | null;
        bestMap: string | null;
      })
    | null;
}

export interface LiveState {
  demo: boolean;
  nickname: string;
  /** Datum (YYYY-MM-DD) des Season-Starts, leer = nicht gesetzt */
  seasonStart: string;
  /** Eigene Rahmen-URL, überschreibt den von Faceit gelesenen Rahmen */
  avatarFrameOverride: string;
  player: PlayerSnapshot | null;
  session: SessionStats | null;
  season: SeasonStats | null;
  /** Die letzten Matches mit Elo-Änderung, in derselben Reihenfolge wie player.recentResults */
  recentMatches: RecentMatch[];
  error: string | null;
  updatedAt: string | null;
}

/** Eine Session gilt als beendet, wenn sie älter als 12 Stunden ist (z. B. am nächsten Tag). */
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** So viele Abrufe wird auf die Elo-Änderung eines neuen Matches gewartet. */
const ELO_WAIT_POLLS = 3;

/** Schlägt das Nachschlagen der Elo bei Faceit fehl, wird es frühestens nach 5 Minuten wiederholt. */
const ELO_RETRY_MS = 5 * 60 * 1000;

/** Fragt Faceit regelmäßig ab, speichert neue Stände und verteilt den Live-Zustand an alle Overlays. */
export class Tracker extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  state: LiveState;

  constructor(
    private readonly source: StatsSource,
    private readonly storage: Storage,
    private readonly intervalSeconds: number,
    defaultNickname: string,
  ) {
    super();
    // Demo-Daten beginnen bei jedem Start neu, eine alte Session passt dann nicht mehr dazu
    if (source.demo) storage.setSetting('session', '');
    this.state = {
      demo: source.demo,
      nickname: storage.getSetting('nickname') ?? defaultNickname,
      seasonStart: storage.getSetting('seasonStart') ?? DEFAULT_SEASON_START,
      avatarFrameOverride: storage.getSetting('avatarFrameUrl') ?? '',
      player: null,
      session: null,
      season: null,
      recentMatches: [],
      error: null,
      updatedAt: null,
    };
  }

  start() {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalSeconds * 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async setNickname(nickname: string) {
    this.state.nickname = nickname.trim();
    this.storage.setSetting('nickname', this.state.nickname);
    this.storage.setSetting('session', '');
    this.state.player = null;
    this.state.session = null;
    this.state.season = null;
    this.state.recentMatches = [];
    await this.poll();
  }

  async setSeasonStart(start: string) {
    this.state.seasonStart = start;
    this.storage.setSetting('seasonStart', start);
    this.state.season = null;
    await this.poll();
  }

  async setAvatarFrameOverride(url: string) {
    this.state.avatarFrameOverride = url;
    this.storage.setSetting('avatarFrameUrl', url);
    await this.poll();
  }

  /** Der Rahmen ändert sich selten, daher höchstens stündlich bei Faceit nachsehen. */
  private frame = { playerId: '', url: '', checkedAt: 0 };

  private async avatarFrame(playerId: string): Promise<string> {
    if (this.state.avatarFrameOverride) return this.state.avatarFrameOverride;
    if (this.frame.playerId !== playerId || Date.now() - this.frame.checkedAt > 60 * 60 * 1000) {
      this.frame = { playerId, url: await this.source.fetchAvatarFrame(playerId), checkedAt: Date.now() };
    }
    return this.frame.url;
  }

  resetSession() {
    if (this.state.player) {
      this.saveSession(this.newSession(this.state.player));
      this.state.session = this.sessionStats(this.state.player);
    }
    this.emit('state', this.state);
  }

  async poll() {
    if (!this.state.nickname && !this.source.demo) {
      this.state.error = 'Kein Faceit-Nickname gesetzt';
      this.emit('state', this.state);
      return;
    }
    try {
      const player = await this.source.fetchPlayer(this.state.nickname);
      player.avatarFrame = await this.avatarFrame(player.playerId);
      const previous = this.storage.latestSnapshot(player.playerId);
      this.storage.saveSnapshot(player);
      await this.recordNewMatches(previous, player);
      this.state.recentMatches = await this.recentMatches(player);
      this.state.player = player;
      this.state.session = this.sessionStats(player);
      await this.updateSeason(player);
      this.state.error = null;
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : String(err);
    }
    this.state.updatedAt = new Date().toISOString();
    this.emit('state', this.state);
  }

  private sessionStats(player: PlayerSnapshot): SessionStats {
    let session = this.loadSession();
    const expired = session && Date.now() - Date.parse(session.startedAt) > SESSION_MAX_AGE_MS;
    // Weniger Matches als beim Start (z. B. Demo-Neustart oder anderer Spieler) = neue Session
    if (!session || expired || session.playerId !== player.playerId || player.matches < session.startMatches) {
      session = this.newSession(player);
      this.saveSession(session);
    }
    const played = this.sessionMatches(player.playerId, session.startedAt);
    const matches = played.length;
    const wins = played.filter((m) => m.result === 'W').length;
    return {
      startedAt: session.startedAt,
      eloChange: player.elo - session.startElo,
      matches,
      wins,
      losses: matches - wins,
    };
  }

  /** Nur Matchmaking zählt: die gespeicherten (bereits gefilterten) Matches seit `since` */
  private sessionMatches(playerId: string, since: string, limit = 200): MatchResult[] {
    return [...this.storage.listMatches(playerId, limit), ...this.pending.map((p) => p.match)].filter((m) => m.finishedAt >= since);
  }

  /**
   * Elo-Verlauf der letzten `count` Matches und Kennzahlen der Season für den Statistik-Tab.
   * Der Verlauf wird vom aktuellen Elo-Stand rückwärts über die Elo-Änderungen der Matches berechnet;
   * fehlt eine Änderung, wird sie wie bei "Letzte Matches" geschätzt.
   */
  overview(count: number): StatsOverview | null {
    const player = this.state.player;
    if (!player) return null;
    const typical = this.typicalElo(player.playerId);
    const points: EloChartPoint[] = [];
    let elo = player.elo;
    for (const m of this.storage.listMatches(player.playerId, count)) {
      const change = m.eloChange ?? (m.result === 'W' ? typical : -typical);
      points.unshift({ matchId: m.matchId, finishedAt: m.finishedAt, result: m.result, map: m.map, elo, change, estimated: m.eloChange === null || !!m.eloEstimated });
      elo -= change;
    }
    points.unshift({ matchId: '', finishedAt: '', result: null, map: '', elo, change: 0, estimated: false });
    const matches = points.length - 1;
    const change = player.elo - elo;
    const values = points.map((p) => p.elo);
    const next = LEVEL_THRESHOLDS.find((min) => min > player.elo);

    // Season: Siege/Niederlagen zählt Faceit (alle Matchmaking-Matches seit Season-Start),
    // Elo, K/D und beste Map kommen aus den eigenen gespeicherten Daten seit Season-Start
    let season: StatsOverview['season'] = null;
    if (this.state.season) {
      const since = new Date(this.state.season.start).toISOString();
      const first = this.storage.eloHistory(player.playerId, since)[0];
      const played = this.sessionMatches(player.playerId, since, 5000);
      const kills = played.reduce((sum, m) => sum + m.kills, 0);
      const deaths = played.reduce((sum, m) => sum + m.deaths, 0);
      // Beste Map: höchste Bilanz (Siege minus Niederlagen), bei Gleichstand mehr Siege; ohne Sieg keine
      const maps = new Map<string, { wins: number; losses: number }>();
      for (const m of played) {
        if (!m.map) continue;
        const r = maps.get(m.map) ?? { wins: 0, losses: 0 };
        r[m.result === 'W' ? 'wins' : 'losses'] += 1;
        maps.set(m.map, r);
      }
      const best = [...maps].filter(([, r]) => r.wins > 0).sort(([, a], [, b]) => b.wins - b.losses - (a.wins - a.losses) || b.wins - a.wins)[0];
      season = {
        ...this.state.season,
        eloChange: first ? player.elo - first.elo : null,
        trackedSince: first?.takenAt ?? null,
        trackedMatches: played.length,
        kd: played.length ? Math.round((kills / Math.max(1, deaths)) * 100) / 100 : null,
        bestMap: best ? best[0] : null,
      };
    }

    return {
      elo: player.elo,
      level: player.level,
      nextLevel: next === undefined ? null : { level: LEVEL_THRESHOLDS.indexOf(next) + 1, elo: next, missing: next - player.elo },
      history: points,
      matches,
      change,
      peak: Math.max(...values),
      low: Math.min(...values),
      avgPerMatch: matches ? Math.round((change / matches) * 10) / 10 : 0,
      season,
    };
  }

  /** Neue Matches, deren Elo-Änderung Faceit noch nicht geliefert hat. */
  private pending: { match: MatchResult; polls: number; batch: MatchResult[] }[] = [];

  /**
   * Erkennt neue Matches, speichert sie und meldet sie per "match"-Event (Editor, Overlay).
   * Gemeldet wird erst, wenn die Elo-Änderung bekannt ist, spätestens nach ELO_WAIT_POLLS Abrufen (dann eloChange = null).
   * Beim allerersten Abruf werden die letzten Matches nur still gespeichert.
   */
  private async recordNewMatches(previous: PlayerSnapshot | null, player: PlayerSnapshot) {
    const changed = !previous || previous.matches !== player.matches || previous.elo !== player.elo;
    try {
      if (changed || this.pending.length) {
        const isKnown = (id: string) => this.storage.hasMatch(id) || this.pending.some((p) => p.match.matchId === id);
        const fresh = (await this.source.fetchRecentMatches(player.playerId, 5, isKnown)).reverse();
        const batch: MatchResult[] = [];
        fresh.forEach((d, i) => {
          const match: MatchResult = { ...d, avatar: player.avatar, avatarFrame: player.avatarFrame, eloBefore: null, eloAfter: null, eloChange: null, level: player.level };
          if (!previous || i < fresh.length - 1) {
            // Erster Start oder ältere von mehreren neuen Matches: Elo wird später gemeinsam geschätzt
            if (previous) batch.push(match);
            this.publish(match, !!previous);
          } else {
            // Bei mehreren neuen Matches gilt die Elo vor dem ältesten davon
            match.eloBefore = batch.length ? previous.elo : (this.eloBefore(player.playerId, match.finishedAt) ?? previous.elo);
            this.pending.push({ match, polls: 0, batch });
          }
        });
      }
    } catch (err) {
      console.error('Match-Details konnten nicht geladen werden:', err instanceof Error ? err.message : err);
    }

    for (const p of [...this.pending]) {
      const known = p.match.eloBefore !== null && player.elo !== p.match.eloBefore;
      p.polls += 1;
      if (!known && p.polls < ELO_WAIT_POLLS) continue;
      if (known && p.batch.length) {
        // Mehrere Matches zwischen zwei Abrufen: Gesamtänderung auf die Matches aufteilen (geschätzt)
        p.match.eloAfter = player.elo;
        this.splitElo([...p.batch, p.match], player.elo - p.match.eloBefore!, player.playerId);
        p.batch.forEach((m) => this.storage.saveMatch(m));
      } else if (known) {
        p.match.eloAfter = player.elo;
        p.match.eloChange = player.elo - p.match.eloBefore!;
      } else {
        p.match.eloBefore = null;
      }
      p.match.level = player.level;
      this.pending = this.pending.filter((x) => x !== p);
      this.publish(p.match, true);
    }
  }

  /** Durchschnittliche Elo-Änderung der gemessenen Matches, als Schätzwert für Matches ohne Elo. */
  private typicalElo(playerId: string): number {
    const exact = this.storage.listMatches(playerId, 20).filter((m) => m.eloChange !== null && !m.eloEstimated);
    if (!exact.length) return 25;
    const avg = exact.reduce((sum, m) => sum + Math.abs(m.eloChange!), 0) / exact.length;
    // Ausreißer (z. B. Elo-Korrekturen von Faceit) sollen die Schätzung nicht verzerren
    return Math.round(Math.min(40, Math.max(15, avg)));
  }

  /** Verteilt `total` so auf die Matches, dass Siege gleich viel bringen wie Niederlagen kosten. */
  private splitElo(matches: MatchResult[], total: number, playerId: string) {
    const wins = matches.filter((m) => m.result === 'W').length;
    const losses = matches.length - wins;
    let per = wins !== losses ? total / (wins - losses) : NaN;
    if (!(per >= 5 && per <= 50)) per = this.typicalElo(playerId);
    for (const m of matches) {
      m.eloChange = Math.round(m.result === 'W' ? per : -per);
      m.eloEstimated = true;
    }
    // Rundungsrest dem neuesten Match geben, solange das Vorzeichen stimmt
    const newest = matches[matches.length - 1];
    const adjusted = newest.eloChange! + total - matches.reduce((sum, m) => sum + m.eloChange!, 0);
    if (Math.sign(adjusted) === Math.sign(newest.eloChange!) && Math.abs(adjusted) <= 60) newest.eloChange = adjusted;
  }

  /** Elo-Änderung eines Matches von Hand setzen (Betrag; Vorzeichen kommt vom Ergebnis). null = wieder schätzen. */
  async setMatchElo(matchId: string, amount: number | null) {
    const player = this.state.player;
    if (!player) throw new Error('Noch kein Spieler geladen');
    const match = this.storage.listMatches(player.playerId, 50).find((m) => m.matchId === matchId);
    if (!match) throw new Error('Match nicht gefunden');
    match.eloChange = amount === null ? null : match.result === 'W' ? Math.abs(amount) : -Math.abs(amount);
    match.eloEstimated = false;
    this.storage.saveMatch(match);
    this.state.recentMatches = await this.recentMatches(player);
    this.emit('state', this.state);
  }

  private eloBefore(playerId: string, finishedAt: string): number | null {
    const before = this.storage.eloHistory(playerId).filter((h) => h.takenAt < finishedAt);
    return before.length ? before[before.length - 1].elo : null;
  }

  /** Für diese Matches wurde die Elo zuletzt bei Faceit nachgeschlagen; ohne Erfolg erst nach ELO_RETRY_MS erneut. */
  private eloLookup = { key: '', at: 0 };
  /** Ob Faceits "Recent Results" mit dem neuesten Match beginnen; wird aus den gespeicherten Matches erkannt. */
  private newestFirst = true;

  /**
   * Die letzten fünf gespeicherten Matches mit Elo-Änderung. Fehlt sie (z. B. Matches vom ersten Start),
   * wird sie aus Faceits Elo-Verlauf nachgeschlagen (Best-Effort) und sonst geschätzt.
   */
  private async recentMatches(player: PlayerSnapshot): Promise<RecentMatch[]> {
    const count = Math.max(player.recentResults.length, 5);
    const stored = this.storage.listMatches(player.playerId, count);
    const missing = stored.filter((m) => m.eloChange === null);
    const key = missing.map((m) => m.matchId).join();
    const due = key !== this.eloLookup.key || Date.now() - this.eloLookup.at > ELO_RETRY_MS;
    if (missing.length && this.source.fetchEloHistory && due) {
      this.eloLookup = { key, at: Date.now() };
      const history = await this.source.fetchEloHistory(player.playerId, count + 1);
      for (const m of missing) {
        const i = history.findIndex((h) => h.matchId === m.matchId);
        if (i < 0) continue;
        const delta = history[i].delta ?? (i + 1 < history.length ? history[i].elo - history[i + 1].elo : null);
        if (delta === null) continue;
        m.eloAfter = history[i].elo;
        m.eloBefore = history[i].elo - delta;
        m.eloChange = delta;
        this.storage.saveMatch(m);
      }
    }

    const results = stored.map((m) => m.result).join('');
    const faceit = player.recentResults.join('');
    const reversed = [...player.recentResults].reverse().join('');
    if (results.length === faceit.length && faceit !== reversed) {
      if (results === faceit) this.newestFirst = true;
      else if (results === reversed) this.newestFirst = false;
    }
    // Matches ohne Elo (z. B. vor dem ersten Start gespielt) bekommen einen Schätzwert
    const typical = this.typicalElo(player.playerId);
    const recent: RecentMatch[] = stored.map(({ matchId, result, eloChange, eloEstimated, map, finishedAt }) => ({
      matchId,
      result,
      eloChange: eloChange ?? (result === 'W' ? typical : -typical),
      estimated: eloChange === null || !!eloEstimated,
      map,
      finishedAt,
    }));
    // Noch nicht genug gespeicherte Matches (z. B. Demo-Modus): Rest ohne Elo aus Faceits Ergebnissen auffüllen
    const faceitNewestFirst = this.newestFirst ? player.recentResults : [...player.recentResults].reverse();
    for (const result of faceitNewestFirst.slice(recent.length)) recent.push({ matchId: '', result, eloChange: result === 'W' ? typical : -typical, estimated: true, map: '', finishedAt: '' });
    return this.newestFirst ? recent : recent.reverse();
  }

  private publish(match: MatchResult, announce: boolean) {
    this.storage.saveMatch(match);
    if (announce) this.emit('match', match);
  }

  /** Die Match-Historie wird nur neu geladen, wenn seit der letzten Berechnung ein Match dazukam. */
  private seasonMatchesAt = -1;

  private async updateSeason(player: PlayerSnapshot) {
    const start = this.state.seasonStart;
    if (!start) {
      this.state.season = null;
      return;
    }
    if (this.state.season?.start === start && this.seasonMatchesAt === player.matches) return;
    const { matches, wins } = await this.source.fetchRecordSince(player.playerId, new Date(start));
    this.seasonMatchesAt = player.matches;
    this.state.season = {
      start,
      matches,
      wins,
      losses: matches - wins,
      winRate: matches ? Math.round((wins / matches) * 100) : 0,
    };
  }

  private newSession(player: PlayerSnapshot): Session {
    return {
      playerId: player.playerId,
      startedAt: new Date().toISOString(),
      startElo: player.elo,
      startMatches: player.matches,
      startWins: player.wins,
    };
  }

  private loadSession(): Session | null {
    const raw = this.storage.getSetting('session');
    return raw ? (JSON.parse(raw) as Session) : null;
  }

  private saveSession(session: Session) {
    this.storage.setSetting('session', JSON.stringify(session));
  }
}
