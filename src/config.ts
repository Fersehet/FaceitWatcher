import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// .env im Projektordner suchen, egal aus welchem Ordner der Server gestartet wurde
const envCandidates = [...new Set([fileURLToPath(new URL('../.env', import.meta.url)), resolve(process.cwd(), '.env')])];
const envFile = envCandidates.find((f) => existsSync(f)) ?? null;
if (envFile) process.loadEnvFile(envFile);

/** Erklärt beim Start, warum der Demo-Modus aktiv ist. */
export function demoReason(): string {
  if (process.env.FACEIT_API_KEY !== undefined) return 'FACEIT_API_KEY ist leer.';
  if (envFile) return `In ${envFile} steht keine Zeile "FACEIT_API_KEY=...".`;
  // Windows blendet Dateiendungen aus, aus ".env" wird beim Speichern leicht ".env.txt"
  const txt = envCandidates.map((f) => `${f}.txt`).find((f) => existsSync(f));
  if (txt) return `Gefunden wurde nur ${txt}. Bitte in ".env" umbenennen (ohne .txt).`;
  return `Keine .env gefunden (gesucht: ${envCandidates.join(', ')}).`;
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  /** 0.0.0.0 = auch im Heimnetz und aus Docker erreichbar */
  host: process.env.HOST || '0.0.0.0',
  faceitApiKey: process.env.FACEIT_API_KEY?.trim() || '',
  defaultNickname: process.env.FACEIT_NICKNAME?.trim() || '',
  pollIntervalSeconds: Math.max(15, Number(process.env.POLL_INTERVAL_SECONDS) || 60),
  dbPath: process.env.DB_PATH || './data/faceitwatcher.db',
  /** Vorlage für die offiziellen Faceit-Level-Symbole, {level} = 1–10 */
  levelIconUrl:
    process.env.LEVEL_ICON_URL ||
    'https://cdn-frontend.faceit-cdn.net/web/static/media/assets_images_skill-icons_skill_level_{level}_svg.svg',
};

export const isDemo = config.faceitApiKey === '';
