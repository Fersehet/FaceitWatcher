import express, { type Response } from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssetCache, isFaceitUrl } from './assets.ts';
import { Auth, type LoginError } from './auth.ts';
import { config, demoReason, isDemo } from './config.ts';
import { FaceitClient } from './faceit/client.ts';
import { DemoSource } from './faceit/demo.ts';
import { createDefaultOverlay, defaultStyle, defaultWidgets, upgradeOverlay, useSeasonWinRate, WIDGET_LABELS } from './overlays/defaults.ts';
import type { Overlay } from './overlays/types.ts';
import { SqliteStorage } from './storage/sqlite.ts';
import { Tracker } from './tracker.ts';

const OWNER = 'local';

const storage = new SqliteStorage(config.dbPath);
const source = isDemo ? new DemoSource() : new FaceitClient(config.faceitApiKey);
const tracker = new Tracker(source, storage, isDemo ? 15 : config.pollIntervalSeconds, config.defaultNickname);

const assets = new AssetCache(join(dirname(config.dbPath), 'assets'), config.levelIconUrl);
const auth = new Auth(join(dirname(config.dbPath), 'session-secret'), config.sessionSecret, {
  name: config.adminUser,
  password: config.adminPassword,
});

if (storage.listOverlays(OWNER).length === 0) storage.saveOverlay(createDefaultOverlay());

// Einmalig: gespeicherte Overlays zeigen statt der Gesamt-Winrate die Winrate der aktuellen Season
if (!storage.getSetting('seasonWinRateMigrated')) {
  for (const overlay of storage.listOverlays(OWNER)) {
    if (useSeasonWinRate(upgradeOverlay(overlay))) storage.saveOverlay(overlay);
  }
  storage.setSetting('seasonWinRateMigrated', '1');
}

// Live-Updates per Server-Sent Events (funktioniert ohne Zusatz in der OBS-Browserquelle)
const clients = new Set<Response>();
function broadcast(event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
tracker.on('state', (state) => broadcast('state', state));
tracker.on('match', (match) => broadcast('match', match));

const app = express();
// Hinter einem Reverse Proxy: echte Besucher-IP (für die Login-Sperre) und https-Erkennung (für sichere Cookies)
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// Optionale eigene Startseite (Ordner SITE_DIR) auf /. Ohne Login erreichbar, fehlt sie, führt / zum Editor.
app.use(express.static(config.siteDir));
const hasStartPage = () => existsSync(join(config.siteDir, 'index.html'));

/** Ohne Login erreichbar: Overlays und Statistiken nur lesend (für OBS und andere Clients), Bilder und der Login selbst. */
function isPublic(req: express.Request) {
  if (['/api/login', '/api/logout', '/api/me'].includes(req.path)) return true;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  return (
    req.path.startsWith('/assets/') ||
    req.path.startsWith('/fonts/') ||
    /^\/overlay\/[\w-]+$/.test(req.path) ||
    /^\/api\/overlays\/[\w-]+$/.test(req.path) ||
    [
      '/api/state', '/api/events', '/api/matches', '/api/history', '/api/stats', '/api/widgets',
      '/login.html', '/css/editor.css', '/js/render.js', '/js/loader.js', '/js/i18n.js',
      '/favicon.svg', '/logo.svg',
    ].includes(req.path)
  );
}

const hostOf = (url: string) => URL.parse(url)?.host ?? null;

// Editor und alle Änderungen nur nach Login, egal ob über localhost, LAN oder eine Domain
app.use((req, res, next) => {
  if (isPublic(req)) return next();
  if (auth.user(req)) {
    // Änderungen nur von der eigenen Seite aus, nicht von fremden Seiten im selben Browser
    const origin = req.headers.origin;
    if (req.method !== 'GET' && req.method !== 'HEAD' && origin && hostOf(origin) !== req.headers.host) {
      return void res.status(403).json({ error: 'Fremde Herkunft' });
    }
    return next();
  }
  if (req.path.startsWith('/api/')) return void res.status(401).json({ error: 'Bitte anmelden' });
  if (req.method === 'GET') return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
  res.status(404).send('Nicht gefunden');
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

app.get('/', (_req, res) => res.redirect('/editor.html'));
app.get('/editor', (_req, res) => res.redirect('/editor.html'));

// Login für den Editor
app.get('/api/me', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ user: auth.user(req), loginEnabled: auth.enabled, startPage: hasStartPage() });
});

const LOGIN_ERRORS: Record<LoginError, { status: number; text: string }> = {
  disabled: { status: 503, text: 'Login ist auf diesem Server nicht eingerichtet (ADMIN_PASSWORD in der .env fehlt).' },
  locked: { status: 429, text: 'Zu viele Versuche. Bitte in 15 Minuten erneut probieren.' },
  wrong: { status: 401, text: 'Benutzername oder Passwort falsch.' },
};

app.post('/api/login', (req, res) => {
  const error = auth.login(req, res, String(req.body?.user ?? ''), String(req.body?.password ?? ''));
  if (error) return void res.status(LOGIN_ERRORS[error].status).json({ error: LOGIN_ERRORS[error].text });
  res.json({ ok: true });
});

app.post('/api/logout', (_req, res) => {
  auth.logout(res);
  res.status(204).end();
});
app.get('/overlay/:id', (_req, res) => res.sendFile(fileURLToPath(new URL('../public/overlay.html', import.meta.url))));

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`event: state\ndata: ${JSON.stringify(tracker.state)}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

// Faceit-Bilder aus dem lokalen Cache (für Editor und Overlay)
app.get('/assets/level/:level', async (req, res) => {
  const asset = await assets.level(Number.parseInt(req.params.level, 10) || 1);
  if (!asset) return void res.status(404).end();
  res.type(asset.contentType).set('Cache-Control', 'public, max-age=86400').send(asset.body);
});

app.get('/assets/remote', async (req, res) => {
  const url = String(req.query.url ?? '');
  // Nur Faceit-Bilder oder der selbst eingetragene Rahmen, damit der Server kein offener Proxy ist
  const allowed = isFaceitUrl(url) || (url !== '' && url === tracker.state.avatarFrameOverride);
  const asset = allowed ? await assets.remote(url, !isFaceitUrl(url)) : null;
  if (!asset) return void res.status(404).end();
  res.type(asset.contentType).set('Cache-Control', 'public, max-age=86400').send(asset.body);
});

app.put('/api/avatar-frame', async (req, res) => {
  const url = String(req.body?.url ?? '').trim();
  if (url && !url.startsWith('https://')) return void res.status(400).json({ error: 'Bitte eine https-Adresse angeben' });
  await tracker.setAvatarFrameOverride(url);
  res.json(tracker.state);
});

app.get('/api/state', (_req, res) => res.json(tracker.state));
// Gespeicherte Matches, neueste zuerst
app.get('/api/matches', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  res.json(storage.listMatches(tracker.state.player?.playerId ?? null, limit));
});

// Auswertung für den Statistik-Tab (Elo-Verlauf, Session), nur aus gespeicherten Daten
app.get('/api/stats', (req, res) => {
  const count = Math.min(50, Math.max(5, Number(req.query.count) || 20));
  res.json(tracker.overview(count));
});

app.get('/api/widgets', (_req, res) => res.json(WIDGET_LABELS));

app.put('/api/nickname', async (req, res) => {
  const nickname = String(req.body?.nickname ?? '').trim();
  if (!nickname) return void res.status(400).json({ error: 'Nickname fehlt' });
  await tracker.setNickname(nickname);
  res.json(tracker.state);
});

app.put('/api/season', async (req, res) => {
  const start = String(req.body?.start ?? '').trim();
  if (start && Number.isNaN(Date.parse(start))) return void res.status(400).json({ error: 'Ungültiges Datum' });
  await tracker.setSeasonStart(start);
  res.json(tracker.state);
});

app.post('/api/session/reset', (_req, res) => {
  tracker.resetSession();
  res.json(tracker.state);
});

app.post('/api/refresh', async (_req, res) => {
  await tracker.poll();
  res.json(tracker.state);
});

app.put('/api/matches/:id/elo', async (req, res) => {
  const raw = req.body?.elo;
  const amount = raw === null || raw === '' || raw === undefined ? null : Number(raw);
  if (amount !== null && (!Number.isInteger(amount) || amount < 0 || amount > 100)) return void res.status(400).json({ error: 'Ungültige Elo' });
  try {
    await tracker.setMatchElo(req.params.id, amount);
    res.json(tracker.state);
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/history', (req, res) => {
  const playerId = tracker.state.player?.playerId;
  if (!playerId) return void res.json([]);
  res.json(storage.eloHistory(playerId, typeof req.query.since === 'string' ? req.query.since : undefined));
});

app.get('/api/overlays', (_req, res) => res.json(storage.listOverlays(OWNER)));

app.get('/api/overlays/:id', (req, res) => {
  const overlay = storage.getOverlay(req.params.id);
  if (!overlay) return void res.status(404).json({ error: 'Overlay nicht gefunden' });
  res.json(upgradeOverlay(overlay));
});

app.post('/api/overlays', (req, res) => {
  const base = req.body?.copyFrom ? storage.getOverlay(String(req.body.copyFrom)) : null;
  const overlay = createDefaultOverlay(String(req.body?.name || 'Neues Overlay'));
  if (base) {
    overlay.style = structuredClone(base.style);
    overlay.widgets = structuredClone(base.widgets);
  }
  storage.saveOverlay(overlay);
  res.status(201).json(overlay);
});

app.put('/api/overlays/:id', (req, res) => {
  const existing = storage.getOverlay(req.params.id);
  if (!existing) return void res.status(404).json({ error: 'Overlay nicht gefunden' });
  const body = req.body as Partial<Overlay>;
  const overlay: Overlay = {
    ...existing,
    name: body.name ?? existing.name,
    style: { ...existing.style, ...body.style },
    widgets: body.widgets ?? existing.widgets,
    updatedAt: new Date().toISOString(),
  };
  storage.saveOverlay(overlay);
  broadcast('overlay', overlay);
  res.json(overlay);
});

// Setzt Design und Elemente auf den Standard zurück, Name und OBS-Adresse bleiben
app.post('/api/overlays/:id/reset', (req, res) => {
  const existing = storage.getOverlay(req.params.id);
  if (!existing) return void res.status(404).json({ error: 'Overlay nicht gefunden' });
  const overlay: Overlay = { ...existing, style: defaultStyle(), widgets: defaultWidgets(), updatedAt: new Date().toISOString() };
  storage.saveOverlay(overlay);
  broadcast('overlay', overlay);
  res.json(overlay);
});

app.delete('/api/overlays/:id', (req, res) => {
  if (storage.listOverlays(OWNER).length <= 1) return void res.status(400).json({ error: 'Das letzte Overlay kann nicht gelöscht werden' });
  storage.deleteOverlay(req.params.id);
  res.status(204).end();
});

app.listen(config.port, config.host, () => {
  console.log(`FaceitWatcher läuft: http://localhost:${config.port}`);
  if (isDemo) console.log(`Demo-Modus aktiv, es werden Beispieldaten angezeigt. Grund: ${demoReason()}`);
  else console.log(`Faceit API-Key geladen (endet auf ...${config.faceitApiKey.slice(-4)}).`);
  if (!auth.enabled) console.log('Hinweis: ADMIN_PASSWORD fehlt in der .env, ohne Passwort kann sich niemand im Editor anmelden.');
  tracker.start();
});
