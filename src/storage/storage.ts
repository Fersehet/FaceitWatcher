import type { PlayerSnapshot } from '../faceit/types.ts';
import type { Overlay } from '../overlays/types.ts';

export interface EloPoint {
  takenAt: string;
  elo: number;
  matches: number;
}

/**
 * Alle Datenzugriffe laufen über dieses Interface.
 * Lokal steckt SQLite dahinter; für die Web-App kann z. B. eine Postgres-Variante
 * dasselbe Interface implementieren, ohne dass Server oder Editor sich ändern.
 */
export interface Storage {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;

  /** Speichert nur, wenn sich Elo oder Matchanzahl seit dem letzten Stand geändert haben. */
  saveSnapshot(snapshot: PlayerSnapshot): boolean;
  latestSnapshot(playerId: string): PlayerSnapshot | null;
  eloHistory(playerId: string, since?: string): EloPoint[];

  listOverlays(ownerId: string): Overlay[];
  getOverlay(id: string): Overlay | null;
  saveOverlay(overlay: Overlay): void;
  deleteOverlay(id: string): void;
}
