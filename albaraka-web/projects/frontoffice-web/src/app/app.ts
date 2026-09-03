import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LOCALES, UI, dirOf, mdToHtml, type Locale } from 'shared-ui';
import { getConfig, streamChat, postFeedback, type SseEvent } from './api';

interface Msg {
  role: 'user' | 'assistant';
  kind: 'user' | 'answer' | 'refusal' | 'error' | 'streaming';
  text: string;
  refusalCode?: string;
  citations?: any[];
  sources?: any[];
  disclaimers?: string[];
  caveats?: string[];
  messageId?: string;
  fatwaRequestRef?: string | null;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  locale = signal<Locale>('fr-FR');
  dir = computed(() => dirOf(this.locale()));
  t = computed(() => UI[this.locale()]);
  msgs = signal<Msg[]>([]);
  input = signal('');
  busy = signal(false);
  statusLabel = signal('');
  suggested = signal<string[]>([]);
  identity = signal<any>(null);
  demoKb = signal(false);
  connected = signal(false);
  deviceId = localStorage.getItem('al-mouchir-device') || crypto.randomUUID();
  private clientSeq = 0;

  constructor() {
    localStorage.setItem('al-mouchir-device', this.deviceId);
    getConfig().then((cfg) => {
      this.identity.set(cfg.identity || {});
      this.demoKb.set(!!cfg.demoKb?.demo);
      this.connected.set(true);
      this.suggested.set(cfg.suggestedQuestions?.[this.locale()] || []);
    }).catch(() => {});
  }

  setLocale(l: Locale) {
    this.locale.set(l);
    document.documentElement.lang = l;
    document.documentElement.dir = dirOf(l);
    getConfig().then((cfg) => this.suggested.set(cfg.suggestedQuestions?.[l] || [])).catch(() => {});
  }

  ask(q?: string) {
    const text = (q ?? this.input()).trim();
    if (!text || this.busy()) return;
    this.input.set('');
    this.busy.set(true);
    this.statusLabel.set('');
    const clientId = crypto.randomUUID();
    this.msgs.update((m) => [...m, { role: 'user', text, kind: 'user' }]);

    let current: Msg = { role: 'assistant', text: '', kind: 'streaming' };
    const patch = (p: Partial<Msg>) => {
      current = { ...current, ...p };
      this.msgs.update((m) => m.map((x, i) => (i === m.length - 1 && x.kind === 'streaming' ? current : x)));
    };

    streamChat(
      text, this.locale(), this.deviceId, clientId,
      (ev: SseEvent) => this.onEvent(ev, patch),
      undefined
    ).catch((e) => {
      patch({ kind: 'error', text: e.message || 'service unavailable' });
    }).finally(() => {
      // streaming bubble becomes a settled answer bubble (patch already applied by answer event)
      this.msgs.update((m) => m.map((x) => (x.kind === 'streaming' ? { ...x, kind: 'error', text: x.text || '…' } : x)));
      this.busy.set(false);
    });
  }

  private onEvent(ev: SseEvent, patch: (p: Partial<Msg>) => void) {
    switch (ev.event) {
      case 'status': this.statusLabel.set(ev.data.label); break;
      case 'token':
        this.msgs.update((m) => {
          const last = m[m.length - 1];
          return m.map((x, i) => (i === m.length - 1 && x.kind === 'streaming' ? { ...x, text: x.text + ev.data.delta } : x));
        });
        break;
      case 'sources': patch({ citations: ev.data.citations }); break;
      case 'answer': patch({ kind: 'answer', text: ev.data.answerMarkdown, citations: ev.data.citations, disclaimers: ev.data.disclaimers, caveats: ev.data.caveats, messageId: ev.data.messageId }); break;
      case 'refusal': patch({ kind: 'refusal', text: `${ev.data.title}\n\n${ev.data.body}`, refusalCode: ev.data.refusalCode, sources: ev.data.sources, messageId: ev.data.messageId, fatwaRequestRef: ev.data.fatwaRequestRef }); break;
      case 'error': patch({ kind: 'error', text: ev.data.code || 'error' }); break;
      case 'done': patch({}); break;
    }
  }

  rate(messageId: string | undefined, rating: string) {
    if (!messageId) return;
    postFeedback({ messageId, rating }).catch(() => {});
  }

  protected readonly LOCALES = LOCALES;
  protected readonly mdToHtml = mdToHtml;
}
