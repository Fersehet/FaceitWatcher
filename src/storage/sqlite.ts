import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { PlayerSnapshot } from '../faceit/types.ts';
import type { Overlay } from '../overlays/types.ts';
import type { EloPoint, Storage } from './storage.ts';

export class SqliteStorage implements Storage {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id TEXT NOT NULL,
        taken_at TEXT NOT NULL,
        elo INTEGER NOT NULL,
        matches INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_player ON snapshots (player_id, taken_at);
      CREATE TABLE IF NOT EXISTS overlays (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  saveSnapshot(s: PlayerSnapshot): boolean {
    const last = this.latestSnapshot(s.playerId);
    if (last && last.elo === s.elo && last.matches === s.matches) return false;
    this.db
      .prepare('INSERT INTO snapshots (player_id, taken_at, elo, matches, data) VALUES (?, ?, ?, ?, ?)')
      .run(s.playerId, s.fetchedAt, s.elo, s.matches, JSON.stringify(s));
    return true;
  }

  latestSnapshot(playerId: string): PlayerSnapshot | null {
    const row = this.db
      .prepare('SELECT data FROM snapshots WHERE player_id = ? ORDER BY id DESC LIMIT 1')
      .get(playerId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as PlayerSnapshot) : null;
  }

  eloHistory(playerId: string, since = '1970-01-01'): EloPoint[] {
    return this.db
      .prepare('SELECT taken_at AS takenAt, elo, matches FROM snapshots WHERE player_id = ? AND taken_at >= ? ORDER BY id')
      .all(playerId, since) as unknown as EloPoint[];
  }

  listOverlays(ownerId: string): Overlay[] {
    const rows = this.db
      .prepare('SELECT data FROM overlays WHERE owner_id = ? ORDER BY name')
      .all(ownerId) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Overlay);
  }

  getOverlay(id: string): Overlay | null {
    const row = this.db.prepare('SELECT data FROM overlays WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Overlay) : null;
  }

  saveOverlay(o: Overlay): void {
    this.db
      .prepare(
        `INSERT INTO overlays (id, owner_id, name, data, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(o.id, o.ownerId, o.name, JSON.stringify(o), o.updatedAt);
  }

  deleteOverlay(id: string): void {
    this.db.prepare('DELETE FROM overlays WHERE id = ?').run(id);
  }
}
