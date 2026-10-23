import express, { type Response } from 'express';
import { fileURLToPath } from 'node:url';
import { config, isDemo } from './config.ts';
import { FaceitClient } from './faceit/client.ts';
import { DemoSource } from './faceit/demo.ts';
import { createDefaultOverlay, defaultWidgets, WIDGET_LABELS } from './overlays/defaults.ts';
import type { Overlay } from './overlays/types.ts';
import { SqliteStorage } from './storage/sqlite.ts';
import { Tracker } from './tracker.ts';

const OWNER = 'local';

const storage = new SqliteStorage(config.dbPath);
const source = isDemo ? new DemoSource() : new FaceitClient(config.faceitApiKey);
const tracker = new Tracker(source, storage, isDemo ? 15 : config.pollIntervalSeconds, config.defaultNickname);

if (storage.listOverlays(OWNER).length === 0) storage.saveOverlay(createDefaultOverlay());

// Live-Updates per Server-Sent Events (funktioniert ohne Zusatz in der OBS-Browserquelle)
const clients = new Set<Response>();
function broadcast(event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
tracker.on('state', (state) => broadcast('state', state));

const app = express();
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

app.get('/api/state', (_req, res) => res.json(tracker.state));
app.get('/api/widgets', (_req, res) => res.json(WIDGET_LABELS));

app.put('/api/nickname', async (req, res) => {
  const nickname = String(req.body?.nickname ?? '').trim();
  if (!nickname) return void res.status(400).json({ error: 'Nickname fehlt' });
  await tracker.setNickname(nickname);
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
  // Neue Stat-Typen aus späteren Versionen ergänzen, ohne bestehende Einstellungen zu verlieren
  const known = new Set(overlay.widgets.map((w) => w.type));
  overlay.widgets.push(...defaultWidgets().filter((w) => !known.has(w.type)).map((w) => ({ ...w, enabled: false })));
  res.json(overlay);
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

app.listen(config.port, () => {
  console.log(`FaceitWatcher läuft: http://localhost:${config.port}`);
  if (isDemo) console.log('Demo-Modus aktiv (kein FACEIT_API_KEY in .env). Es werden Beispieldaten angezeigt.');
  tracker.start();
});
