/**
 * providers.js — chat + embedding adapters.
 *
 * MOCK (default): deterministic, zero-cost, no network — the documented `local-mock` profile.
 * LIVE: the exact shapes the Spring adapters use (compatible OpenAI / GenAI endpoints), guarded
 * by presence of the API keys; tools/spike validates the same endpoints.
 */
import { config } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function chatCompletion({ messages, model = 'llama-3.3-70b-versatile', maxTokens = 700, temperature = 0.2 }) {
  if (config.providerMode === 'MOCK' || !config.groq.apiKey) {
    await sleep(120);
    return { content: messages.at(-1)?.content || '', mock: true, model };
  }
  const r = await fetch(`${config.groq.baseUrl}/openai/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.groq.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`provider: Groq HTTP ${r.status}`);
  const j = await r.json();
  return { content: j.choices?.[0]?.message?.content || '', model: j.model || model, mock: false };
}

export async function embed(text) {
  if (config.providerMode === 'MOCK' || !config.google.apiKey) {
    // deterministic pseudo-vector — retrieval in the demo is lexical (rag.js); the embedding is
    // stored with its model/dimension so the searchable gate stays honest
    let h = 2166136261;
    for (const ch of text) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
    const v = new Array(1536).fill(0);
    for (let i = 0; i < v.length; i++) v[i] = Math.sin(h + i) * 0.01;
    return { values: v, mock: true };
  }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${encodeURIComponent(config.google.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'models/gemini-embedding-001', content: { parts: [{ text }] } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`provider: Google HTTP ${r.status}`);
  const j = await r.json();
  return { values: j.embedding?.values || [], mock: false };
}
