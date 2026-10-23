/** Ein Discord-Embed (nur die Felder, die der Bot benutzt). */
export interface Embed {
  title: string;
  url?: string;
  author?: { name: string; url?: string; icon_url?: string };
  description?: string;
  color: number;
  thumbnail?: { url: string };
  fields: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

export interface Notifier {
  readonly name: string;
  /** Prüft beim Start, ob Token/Webhook funktionieren. */
  check(): Promise<void>;
  send(embed: Embed): Promise<void>;
}

const API = 'https://discord.com/api/v10';

async function post(url: string, headers: Record<string, string>, body: unknown, retried = false): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (res.status === 429 && !retried) {
    const data = (await res.json().catch(() => ({}))) as { retry_after?: number };
    await new Promise((r) => setTimeout(r, Math.ceil((data.retry_after ?? 1) * 1000)));
    return post(url, headers, body, true);
  }
  if (!res.ok) throw new Error(discordError(res.status, await res.text().catch(() => '')));
}

function discordError(status: number, text: string): string {
  if (status === 401) return 'Discord: Bot-Token ungültig';
  if (status === 403) return 'Discord: Bot hat keine Berechtigung, in diesen Channel zu schreiben ("Nachrichten senden" + "Links einbetten")';
  if (status === 404) return 'Discord: Channel oder Webhook nicht gefunden';
  return `Discord Fehler ${status}: ${text.slice(0, 200)}`;
}

/** Schreibt als Bot-User per REST in einen Channel. Braucht keine dauerhafte Gateway-Verbindung. */
export class BotNotifier implements Notifier {
  readonly name = 'Discord-Bot';

  constructor(
    private readonly token: string,
    private readonly channelId: string,
  ) {}

  private get headers() {
    return { Authorization: `Bot ${this.token}` };
  }

  async check() {
    const me = await fetch(`${API}/users/@me`, { headers: this.headers });
    if (!me.ok) throw new Error(discordError(me.status, await me.text().catch(() => '')));
    const channel = await fetch(`${API}/channels/${this.channelId}`, { headers: this.headers });
    if (!channel.ok) throw new Error(discordError(channel.status, await channel.text().catch(() => '')));
    const user = (await me.json()) as { username: string };
    const ch = (await channel.json()) as { name?: string };
    console.log(`[discord] angemeldet als ${user.username}, schreibe in #${ch.name ?? this.channelId}`);
  }

  send(embed: Embed) {
    return post(`${API}/channels/${this.channelId}/messages`, this.headers, { embeds: [embed] });
  }
}

/** Alternative ohne Bot-Account: ein Channel-Webhook (Channel-Einstellungen → Integrationen → Webhooks). */
export class WebhookNotifier implements Notifier {
  readonly name = 'Discord-Webhook';

  constructor(private readonly url: string) {}

  async check() {
    const res = await fetch(this.url);
    if (!res.ok) throw new Error(discordError(res.status, await res.text().catch(() => '')));
    const hook = (await res.json()) as { name?: string };
    console.log(`[discord] Webhook "${hook.name ?? '?'}" bereit`);
  }

  send(embed: Embed) {
    return post(this.url, {}, { username: 'FaceitWatcher', embeds: [embed] });
  }
}

/** Ohne Discord-Konfiguration: gibt die Nachrichten nur im Log aus (zum Testen). */
export class ConsoleNotifier implements Notifier {
  readonly name = 'Konsole (kein Discord konfiguriert)';

  async check() {}

  async send(embed: Embed) {
    console.log(`[discord:test] ${embed.title}\n` + embed.fields.map((f) => `  ${f.name}: ${f.value}`).join('\n'));
  }
}
