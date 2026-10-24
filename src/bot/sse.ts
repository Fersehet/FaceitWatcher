export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Liest einen Server-Sent-Events-Stream, bis die Verbindung endet.
 * `onOpen` läuft, sobald der Server geantwortet hat.
 */
export async function readSse(url: string, onOpen: () => void, onEvent: (e: SseEvent) => void, signal?: AbortSignal) {
  const res = await fetch(url, { headers: { Accept: 'text/event-stream' }, signal });
  if (!res.ok || !res.body) throw new Error(`SSE ${url}: HTTP ${res.status}`);
  onOpen();

  const decoder = new TextDecoder();
  let buffer = '';
  let event = 'message';
  let data: string[] = [];

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (line === '') {
        if (data.length) onEvent({ event, data: data.join('\n') });
        event = 'message';
        data = [];
      } else if (line.startsWith(':')) {
        // Kommentar / Ping
      } else {
        const i = line.indexOf(':');
        const field = i < 0 ? line : line.slice(0, i);
        const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      }
    }
  }
}
