import { EventEmitter } from 'node:events';
import type { PlayerSnapshot, StatsSource } from './faceit/types.ts';
import type { Storage } from './storage/storage.ts';

export interface Session {
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

export interface LiveState {
  demo: boolean;
  nickname: string;
  player: PlayerSnapshot | null;
  session: SessionStats | null;
  error: string | null;
  updatedAt: string | null;
}

/** Eine Session gilt als beendet, wenn sie älter als 12 Stunden ist (z. B. am nächsten Tag). */
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

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
    this.state = {
      demo: source.demo,
      nickname: storage.getSetting('nickname') ?? defaultNickname,
      player: null,
      session: null,
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
    await this.poll();
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
      this.storage.saveSnapshot(player);
      this.state.player = player;
      this.state.session = this.sessionStats(player);
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
    if (!session || expired || player.matches < session.startMatches) {
      session = this.newSession(player);
      this.saveSession(session);
    }
    const matches = player.matches - session.startMatches;
    const wins = player.wins - session.startWins;
    return {
      startedAt: session.startedAt,
      eloChange: player.elo - session.startElo,
      matches,
      wins,
      losses: matches - wins,
    };
  }

  private newSession(player: PlayerSnapshot): Session {
    return {
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
