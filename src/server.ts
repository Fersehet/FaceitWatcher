import express, { type Response } from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssetCache, isFaceitUrl } from './assets.ts';
import { config, demoReason, isDemo } from './config.ts';
import { FaceitClient } from './faceit/client.ts';
import { DemoSource } from './faceit/demo.ts';
import { createDefaultOverlay, upgradeOverlay, WIDGET_LABELS } from './overlays/defaults.ts';
import type { Overlay } from './overlays/types.ts';
import { SqliteStorage } from './storage/sqlite.ts';
import { Tracker } from './tracker.ts';

const OWNER = 'local';

const storage = new SqliteStorage(config.dbPath);
const source = isDemo ? new DemoSource() : new FaceitClient(config.faceitApiKey);
const tracker = new Tracker(source, storage, isDemo ? 15 : config.pollIntervalSeconds, config.defaultNickname);

const assets = new AssetCache(join(dirname(config.dbPath), 'assets'), config.levelIconUrl);

if (storage.listOverlays(OWNER).length === 0) storage.saveOverlay(createDefaultOverlay());

// Live-Updates per Server-Sent Events (funktioniert ohne Zusatz in der OBS-Browserquelle)
const clients = new Set<Response>();
function broadcast(event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
tracker.on('state', (state) => broadcast('state', state));
tracker.on('match', (match) => broadcast('match', match));

const app = express();

// Landingpage: immer unter /site, auf den Domains aus SITE_HOST ausschließlich die Landingpage.
// Die Vorschau dort nutzt den echten Overlay-Renderer und das erste gespeicherte Overlay (nur lesend).
const site = express.Router();
site.get('/js/render.js', (_req, res) => res.sendFile(fileURLToPath(new URL('../public/js/render.js', import.meta.url))));
site.get('/live.json', (_req, res) => {
  const overlay = storage.listOverlays(OWNER)[0];
  res.set('Cache-Control', 'no-cache').json({ overlay: overlay ? upgradeOverlay(overlay) : null, state: tracker.state });
});
site.use(express.static(fileURLToPath(new URL('../website', import.meta.url))));
if (config.siteHosts.length > 0) {
  app.use((req, res, next) => {
    if (!config.siteHosts.includes(req.hostname.toLowerCase())) return next();
    // Bilder für das Overlay (Avatar, Level) dürfen durch, Editor und API bleiben von außen unerreichbar
    if (req.method === 'GET' && req.path.startsWith('/assets/')) return next();
    site(req, res, () => void res.status(404).send('Nicht gefunden'));
  });
}
app.use('/site', site);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

app.get('/', (_req, res) => res.redirect('/editor.html'));
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

// Faceit-Bilder aus dem lokalen Cache (für Overlay und Discord-Bot)
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
// Für den Discord-Bot und andere Clients: gespeicherte Matches, neueste zuerst
app.get('/api/matches', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  res.json(storage.listMatches(tracker.state.player?.playerId ?? null, limit));
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

app.delete('/api/overlays/:id', (req, res) => {
  if (storage.listOverlays(OWNER).length <= 1) return void res.status(400).json({ error: 'Das letzte Overlay kann nicht gelöscht werden' });
  storage.deleteOverlay(req.params.id);
  res.status(204).end();
});

app.listen(config.port, config.host, () => {
  console.log(`FaceitWatcher läuft: http://localhost:${config.port}`);
  if (isDemo) console.log(`Demo-Modus aktiv, es werden Beispieldaten angezeigt. Grund: ${demoReason()}`);
  else console.log(`Faceit API-Key geladen (endet auf ...${config.faceitApiKey.slice(-4)}).`);
  tracker.start();
});
