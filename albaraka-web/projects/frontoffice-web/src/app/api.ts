/** SSE chat client — POST /api/v1/chat/messages/send over fetch-stream (docs/08 §3.1 frames). */
export type Locale = 'fr-FR' | 'ar-TN' | 'en-GB';

export interface Citation {
  id: string; chunkId: string; documentId: string; documentTitle: string;
  url: string; locale: Locale; score: number; validUntil: string | null;
}
export interface SseAnswer {
  messageId: string; answerMarkdown: string; language: Locale; dir: 'ltr' | 'rtl';
  confidence: number; usedSources: string[]; citations: Citation[];
  caveats: string[]; disclaimers: string[]; needsHuman: boolean; cached: boolean;
  models: { chat: string; reranker: string; degradationStep: number };
  latencyMs: number; ttftMs: number;
}
export interface SseRefusal {
  messageId: string; refusalCode: string; title: string; body: string; locale: Locale;
  sources: { documentId: string; title: string; score: number }[];
  fatwaRequestRef: string | null; handoffAvailable: boolean;
}
export interface SseEvent { event: string; data: any; }

type Emit = (ev: SseEvent) => void;

export function streamChat(
  text: string, locale: Locale, deviceId: string, clientId: string, emit: Emit,
  signal?: AbortSignal
): Promise<void> {
  return fetch('/api/v1/chat/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, locale, clientId, deviceId }),
    signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error?.message || `HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const evLine = block.split('\n').find((l) => l.startsWith('event: '));
        const dataLines = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6));
        if (!evLine || !dataLines.length) continue;
        let data: any = null;
        try { data = JSON.parse(dataLines.join('\n')); } catch { data = dataLines.join('\n'); }
        emit({ event: evLine.slice(7).trim(), data });
      }
    }
  });
}

export async function getConfig(): Promise<any> {
  return fetch('/api/v1/assistant/config').then((r) => r.json());
}

export async function postFeedback(payload: { messageId: string; rating: string; comment?: string }): Promise<void> {
  await fetch('/api/v1/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
