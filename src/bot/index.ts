import { BotNotifier, ConsoleNotifier, WebhookNotifier, type Notifier } from './discord.ts';
import { matchEmbed } from './embed.ts';
import { SentStore } from './sent-store.ts';
import { readSse } from './sse.ts';
import type { MatchResult as ServerMatch } from '../faceit/types.ts';

try {
  process.loadEnvFile();
} catch {
  // Keine .env: Werte kommen aus der Umgebung (z. B. docker-compose)
}

const env = (name: string) => process.env[name]?.trim() || '';
const serverUrl = (env('FACEITWATCHER_URL') || 'http://localhost:3000').replace(/\/$/, '');
const dataDir = env('BOT_DATA_DIR') || './data/bot';

function createNotifier(): Notifier {
  const token = env('DISCORD_BOT_TOKEN');
  const channel = env('DISCORD_CHANNEL_ID');
  const webhook = env('DISCORD_WEBHOOK_URL');
  if (token && channel) return new BotNotifier(token, channel);
  if (webhook) return new WebhookNotifier(webhook);
  if (token || channel) throw new Error('DISCORD_BOT_TOKEN und DISCORD_CHANNEL_ID müssen beide gesetzt sein');
  return new ConsoleNotifier();
}

const notifier = createNotifier();
const sent = new SentStore(`${dataDir}/sent.json`);
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

// Alles nacheinander abarbeiten, damit Sync und Live-Events nichts doppelt posten
let queue: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>) {
  queue = queue.then(task).catch((err) => log(`[bot] Fehler: ${err instanceof Error ? err.message : err}`));
  return queue;
}

async function post(match: ServerMatch) {
  if (sent.has(match.matchId)) return;
  await notifier.send(matchEmbed(match));
  sent.add(match.matchId);
  log(`[bot] gepostet: ${match.nickname} ${match.result} ${match.map} ${match.score} (${match.matchId})`);
}

/** Holt die gespeicherten Matches und postet, was während einer Unterbrechung verpasst wurde. */
async function catchUp() {
  const res = await fetch(`${serverUrl}/api/matches?limit=20`);
  if (!res.ok) throw new Error(`GET /api/matches: HTTP ${res.status}`);
  const matches = ((await res.json()) as ServerMatch[]).slice().reverse(); // älteste zuerst
  if (!sent.initialized) {
    sent.add(...matches.map((m) => m.matchId));
    log(`[bot] erster Start: ${matches.length} vorhandene Matches übersprungen, ab jetzt wird jedes neue gepostet`);
    return;
  }
  for (const m of matches) await post(m);
}

async function run() {
  log(`[bot] Ausgabe: ${notifier.name}`);
  await notifier.check();

  if (process.argv.includes('--test')) {
    await notifier.send(matchEmbed(sampleMatch()));
    log('[bot] Testnachricht gesendet');
    return;
  }

  let delay = 2000;
  for (;;) {
    try {
      await readSse(
        `${serverUrl}/api/events`,
        () => {
          log(`[bot] verbunden mit ${serverUrl}`);
          delay = 2000;
          void enqueue(catchUp);
        },
        (e) => {
          if (e.event !== 'match') return;
          const match = JSON.parse(e.data) as ServerMatch;
          void enqueue(() => post(match));
        },
      );
      log('[bot] Verbindung zum Server beendet');
    } catch (err) {
      log(`[bot] Server nicht erreichbar (${err instanceof Error ? err.message : err}), neuer Versuch in ${delay / 1000}s`);
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 60_000);
  }
}

function sampleMatch(): ServerMatch {
  return {
    matchId: 'test',
    playerId: 'test',
    nickname: 'FaceitWatcher-Test',
    avatar: '',
    avatarFrame: '',
    finishedAt: new Date().toISOString(),
    result: 'W',
    map: 'de_mirage',
    score: '13 / 9',
    kills: 24,
    deaths: 15,
    assists: 5,
    kd: 1.6,
    adr: 91.3,
    hsPercent: 52,
    mvps: 4,
    eloBefore: 1985,
    eloAfter: 2010,
    eloChange: 25,
    level: 10,
    url: 'https://www.faceit.com/de',
  };
}

run().catch((err) => {
  console.error(`[bot] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
