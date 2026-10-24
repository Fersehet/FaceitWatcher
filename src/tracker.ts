import { EventEmitter } from 'node:events';
import type { MatchResult, PlayerSnapshot, StatsSource } from './faceit/types.ts';
import type { Storage } from './storage/storage.ts';

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
      seasonStart: storage.getSetting('seasonStart') ?? '',
      avatarFrameOverride: storage.getSetting('avatarFrameUrl') ?? '',
      player: null,
      session: null,
      season: null,
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
  private frame = { nickname: '', url: '', checkedAt: 0 };

  private async avatarFrame(nickname: string): Promise<string> {
    if (this.state.avatarFrameOverride) return this.state.avatarFrameOverride;
    if (this.frame.nickname !== nickname || Date.now() - this.frame.checkedAt > 60 * 60 * 1000) {
      this.frame = { nickname, url: await this.source.fetchAvatarFrame(nickname), checkedAt: Date.now() };
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
      player.avatarFrame = await this.avatarFrame(player.nickname);
      const previous = this.storage.latestSnapshot(player.playerId);
      this.storage.saveSnapshot(player);
      await this.recordNewMatches(previous, player);
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
    const matches = Math.max(0, player.matches - session.startMatches);
    // Faceit zählt "Wins" manchmal etwas später hoch als "Matches", daher begrenzen
    const wins = Math.min(matches, Math.max(0, player.wins - session.startWins));
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
   * Erkennt neue Matches, speichert sie und meldet sie per "match"-Event (Overlay, Discord-Bot).
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
