import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const KEEP = 500;

/** Merkt sich, welche Matches schon in Discord gepostet wurden (überlebt Neustarts). */
export class SentStore {
  private ids: string[] = [];
  /** false = erster Start: vorhandene Matches nur merken, nicht posten. */
  initialized = false;

  constructor(private readonly path: string) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as { ids?: string[] };
      this.ids = Array.isArray(data.ids) ? data.ids : [];
      this.initialized = true;
    } catch {
      // Datei fehlt: erster Start
    }
  }

  has(matchId: string) {
    return this.ids.includes(matchId);
  }

  add(...matchIds: string[]) {
    this.ids = [...this.ids, ...matchIds.filter((id) => !this.has(id))].slice(-KEEP);
    this.initialized = true;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ids: this.ids }));
    renameSync(tmp, this.path);
  }
}
