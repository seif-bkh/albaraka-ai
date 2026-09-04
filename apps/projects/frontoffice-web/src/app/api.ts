/** Frontoffice API client — specs/openapi.yaml frontoffice paths (docs/08 §3). */
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

/** The anonymous capability: one explicit conversation per locale, held client-side. */
const CONV_KEY = (locale: string) => `al-mouchir-conv-${locale}`;

async function conversationId(locale: Locale): Promise<string> {
  const cached = localStorage.getItem(CONV_KEY(locale));
  if (cached) return cached;
  const res = await fetch('/api/v1/assistant/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: 'WEB_APP', locale }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const conv = await res.json();
  localStorage.setItem(CONV_KEY(locale), conv.id);
  return conv.id;
}

function resetConversation(locale: Locale): void {
  localStorage.removeItem(CONV_KEY(locale));
}

async function readSse(res: Response, emit: Emit): Promise<void> {
  const reader = res.body!.getReader();
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
      // Spring's ServerSentEvent encoder writes 'event:answer' without a space and 'data:{...}'
      // without a space — both are valid SSE (field name followed by optional space). Match the
      // field prefix, not the exact 'event: ' spelling.
      const evLine = block.split('\n').find((l) => l.startsWith('event:'));
      const dataLines = block.split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice('data:'.length).trimStart());
      if (!evLine || dataLines.length === 0) continue;
      let data: any = null;
      try { data = JSON.parse(dataLines.join('\n')); } catch { data = dataLines.join('\n'); }
      emit({ event: evLine.slice('event:'.length).trim(), data });
    }
  }
}

export function streamChat(
  text: string, locale: Locale, clientId: string, emit: Emit, signal?: AbortSignal
): Promise<void> {
  return (async () => {
    let id = await conversationId(locale);
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`/api/v1/assistant/conversations/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, locale, clientId }),
        signal,
      });
      if (!res.ok) {
        // the conversation was erased/expired — recreate once and resend
        if (res.status === 404 && attempt === 0) {
          resetConversation(locale);
          id = await conversationId(locale);
          continue;
        }
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message || `HTTP ${res.status}`);
      }
      return readSse(res, emit);
    }
  })();
}

export async function getConfig(): Promise<any> {
  const r = await fetch('/api/v1/assistant/config');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function postFeedback(payload: {
  messageId: string; rating: string; comment?: string;
}): Promise<void> {
  await fetch(`/api/v1/assistant/messages/${payload.messageId}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rating: payload.rating,
      comment: payload.comment ?? null,
      contactOptIn: false,
    }),
  });
}
