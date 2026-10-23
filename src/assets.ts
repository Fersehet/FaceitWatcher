import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Lädt Bilder von Faceit (Level-Symbole, Avatar, Avatar-Rahmen) einmal herunter und
 * liefert sie danach aus dem lokalen Cache. Overlay und Discord-Bot nutzen dieselben Dateien.
 * Die Bilder gehören Faceit und werden deshalb nicht im Repo mitgeliefert, sondern nur lokal zwischengespeichert.
 */
export class AssetCache {
  private inflight = new Map<string, Promise<CachedAsset | null>>();

  constructor(
    private readonly dir: string,
    private readonly levelIconUrl: string,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  /** Offizielles Faceit-Level-Symbol (1–10). */
  level(level: number): Promise<CachedAsset | null> {
    const n = Math.min(10, Math.max(1, Math.round(level)));
    return this.fetchCached(this.levelIconUrl.replace('{level}', String(n)), `level-${n}`);
  }

  /** Bild von Faceit (Avatar, Rahmen). Andere Hosts nur mit `allowOtherHost` (selbst eingetragener Rahmen). */
  remote(url: string, allowOtherHost = false): Promise<CachedAsset | null> {
    if (!isFaceitUrl(url) && !(allowOtherHost && url.startsWith('https://'))) return Promise.resolve(null);
    return this.fetchCached(url, createHash('sha1').update(url).digest('hex'));
  }

  private fetchCached(url: string, key: string): Promise<CachedAsset | null> {
    const file = join(this.dir, key);
    const meta = `${file}.type`;
    if (existsSync(file) && existsSync(meta)) {
      return Promise.resolve({ body: readFileSync(file), contentType: readFileSync(meta, 'utf8') });
    }
    const running = this.inflight.get(key);
    if (running) return running;

    const job = (async () => {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'FaceitWatcher' } });
        const contentType = res.headers.get('content-type') ?? '';
        if (!res.ok || !contentType.startsWith('image/')) return null;
        const body = Buffer.from(await res.arrayBuffer());
        writeFileSync(file, body);
        writeFileSync(meta, contentType);
        return { body, contentType };
      } catch {
        return null;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, job);
    return job;
  }
}

export interface CachedAsset {
  body: Buffer;
  contentType: string;
}

export function isFaceitUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && (hostname === 'faceit.com' || hostname.endsWith('.faceit.com') || hostname.endsWith('.faceit-cdn.net'));
  } catch {
    return false;
  }
}
