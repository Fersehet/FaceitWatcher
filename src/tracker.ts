import { EventEmitter } from 'node:events';
import type { MatchResult, PlayerSnapshot, RecentMatch, StatsSource } from './faceit/types.ts';
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
    // Nur Matchmaking zählt: aus den gespeicherten (bereits gefilterten) Matches seit Session-Start
    const since = session.startedAt;
    const played = [...this.storage.listMatches(player.playerId, 200), ...this.pending.map((p) => p.match)].filter((m) => m.finishedAt >= since);
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

  /** Neue Matches, deren Elo-Änderung Faceit noch nicht geliefert hat. */
  private pending: { match: MatchResult; polls: number }[] = [];

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
        fresh.forEach((d, i) => {
          const match: MatchResult = { ...d, avatar: player.avatar, avatarFrame: player.avatarFrame, eloBefore: null, eloAfter: null, eloChange: null, level: player.level };
          if (!previous || i < fresh.length - 1) {
            // Erster Start oder ältere von mehreren neuen Matches: Elo nicht zuordenbar
            this.publish(match, !!previous);
          } else {
            match.eloBefore = this.eloBefore(player.playerId, match.finishedAt) ?? previous.elo;
            this.pending.push({ match, polls: 0 });
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
      if (known) {
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

  private eloBefore(playerId: string, finishedAt: string): number | null {
    const before = this.storage.eloHistory(playerId).filter((h) => h.takenAt < finishedAt);
    return before.length ? before[before.length - 1].elo : null;
  }

  /** Für diese Matches wurde die Elo schon bei Faceit nachgeschlagen (nur einmal pro Satz fehlender Matches). */
  private eloLookedUp = '';
  /** Ob Faceits "Recent Results" mit dem neuesten Match beginnen; wird aus den gespeicherten Matches erkannt. */
  private newestFirst = true;

  /**
   * Die letzten fünf gespeicherten Matches mit Elo-Änderung. Fehlt sie (z. B. Matches vom ersten Start),
   * wird sie einmalig aus Faceits Elo-Verlauf berechnet und gespeichert.
   */
  private async recentMatches(player: PlayerSnapshot): Promise<RecentMatch[]> {
    const count = Math.max(player.recentResults.length, 5);
    const stored = this.storage.listMatches(player.playerId, count);
    const missing = stored.filter((m) => m.eloChange === null);
    const key = missing.map((m) => m.matchId).join();
    if (missing.length && this.source.fetchEloHistory && key !== this.eloLookedUp) {
      this.eloLookedUp = key;
      const history = await this.source.fetchEloHistory(player.playerId, count + 1);
      for (const m of missing) {
        const i = history.findIndex((h) => h.matchId === m.matchId);
        if (i < 0 || i + 1 >= history.length) continue;
        m.eloAfter = history[i].elo;
        m.eloBefore = history[i + 1].elo;
        m.eloChange = m.eloAfter - m.eloBefore;
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
    const recent: RecentMatch[] = stored.map(({ matchId, result, eloChange }) => ({ matchId, result, eloChange }));
    // Noch nicht genug gespeicherte Matches (z. B. Demo-Modus): Rest ohne Elo aus Faceits Ergebnissen auffüllen
    const faceitNewestFirst = this.newestFirst ? player.recentResults : [...player.recentResults].reverse();
    for (const result of faceitNewestFirst.slice(recent.length)) recent.push({ matchId: '', result, eloChange: null });
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
