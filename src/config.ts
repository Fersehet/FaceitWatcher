import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

// .env im Projektordner suchen, egal aus welchem Ordner der Server gestartet wurde
const envCandidates = [...new Set([fileURLToPath(new URL('../.env', import.meta.url)), resolve(process.cwd(), '.env')])];
const envFile = envCandidates.find((f) => existsSync(f)) ?? null;
if (envFile) loadEnv(envFile);

/**
 * Wie process.loadEnvFile, versteht aber auch UTF-16 und BOM (z. B. von Windows-Editoren oder PowerShell erzeugt).
 * Bereits gesetzte Umgebungsvariablen (z. B. aus Docker) haben Vorrang.
 */
function loadEnv(file: string) {
  const raw = readFileSync(file);
  const text = (raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8')).replace(/^\uFEFF/, '');
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

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
  /** Ordner der Landingpage (liegt in einem eigenen, privaten Repo). Fehlt er, führt / direkt zum Editor. */
  siteDir: resolve(fileURLToPath(new URL('..', import.meta.url)), process.env.SITE_DIR || 'website'),
  /** Zugang zum Editor. Ohne Passwort kann sich niemand anmelden. */
  adminUser: process.env.ADMIN_USER?.trim() || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  /** Schlüssel für die Login-Cookies. Leer = wird einmalig zufällig erzeugt und neben der Datenbank gespeichert. */
  sessionSecret: process.env.SESSION_SECRET?.trim() || '',
  /** Vorlage für die offiziellen Faceit-Level-Symbole, {level} = 1–10 */
  levelIconUrl:
    process.env.LEVEL_ICON_URL ||
    'https://cdn-frontend.faceit-cdn.net/web/static/media/assets_images_skill-icons_skill_level_{level}_svg.svg',
};

export const isDemo = config.faceitApiKey === '';
