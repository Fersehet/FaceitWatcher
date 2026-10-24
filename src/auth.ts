import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Request, Response } from 'express';

const COOKIE = 'fw_session';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

export type LoginError = 'disabled' | 'locked' | 'wrong';

type User = { name: string; salt: Buffer; hash: Buffer };

/**
 * Login für den Editor über die Website. Zurzeit ein einzelner Zugang aus der .env,
 * die Nutzerliste ist aber schon so angelegt, dass später mehrere dazukommen können.
 * Die Sitzung steckt signiert im Cookie, ein Neustart meldet also niemanden ab.
 */
export class Auth {
  private users = new Map<string, User>();
  private key: Buffer;
  private fails = new Map<string, { count: number; until: number }>();

  constructor(secretFile: string, secretFromEnv: string, admin: { name: string; password: string }) {
    if (admin.password) this.users.set(admin.name.toLowerCase(), hashUser(admin.name, admin.password));
    // Das Passwort fließt in den Schlüssel ein: Passwort ändern = alle Sitzungen abmelden
    const secret = secretFromEnv || loadOrCreateSecret(secretFile);
    this.key = createHmac('sha256', secret).update(admin.password).digest();
  }

  get enabled() {
    return this.users.size > 0;
  }

  /** Angemeldeter Nutzer oder null. */
  user(req: Request): string | null {
    const raw = readCookie(req, COOKIE);
    if (!raw) return null;
    const [payload, sig] = raw.split('.');
    if (!payload || !sig || !safeEqual(Buffer.from(sig), Buffer.from(this.sign(payload)))) return null;
    try {
      const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (typeof u !== 'string' || typeof exp !== 'number' || exp < Date.now() / 1000) return null;
      return this.users.has(u.toLowerCase()) ? u : null;
    } catch {
      return null;
    }
  }

  /** Prüft die Zugangsdaten und setzt bei Erfolg das Cookie. Gibt den Grund des Fehlschlags zurück oder null. */
  login(req: Request, res: Response, name: string, password: string): LoginError | null {
    if (!this.enabled) return 'disabled';
    const ip = req.ip ?? '';
    const now = Date.now();
    const entry = this.fails.get(ip);
    if (entry && entry.until > now && entry.count >= MAX_FAILS) return 'locked';

    const user = this.users.get(name.trim().toLowerCase());
    // Auch bei unbekanntem Namen rechnen, damit die Antwortzeit nichts verrät
    const hash = scryptSync(password, user?.salt ?? Buffer.alloc(16), 32);
    if (!user || !safeEqual(hash, user.hash)) {
      const fresh = !entry || entry.until <= now;
      this.fails.set(ip, { count: fresh ? 1 : entry.count + 1, until: fresh ? now + FAIL_WINDOW_MS : entry.until });
      return 'wrong';
    }
    this.fails.delete(ip);

    const payload = Buffer.from(JSON.stringify({ u: user.name, exp: Math.floor(now / 1000) + MAX_AGE_SECONDS })).toString('base64url');
    res.cookie(COOKIE, `${payload}.${this.sign(payload)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: MAX_AGE_SECONDS * 1000,
      path: '/',
    });
    return null;
  }

  logout(res: Response) {
    res.clearCookie(COOKIE, { path: '/' });
  }

  private sign(payload: string) {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}

function hashUser(name: string, password: string): User {
  const salt = randomBytes(16);
  return { name, salt, hash: scryptSync(password, salt, 32) };
}

function safeEqual(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b);
}

function loadOrCreateSecret(file: string) {
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = randomBytes(32).toString('hex');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
