import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { api, login, logout, me, type Me } from './admin-api';

type Tab = 'dashboard' | 'documents' | 'reviews' | 'models' | 'audit';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  user = signal<Me | null>(null);
  tab = signal<Tab>('dashboard');
  loading = signal(false);
  error = signal('');

  email = signal('');
  password = signal('');

  dash = signal<any>(null);
  docs = signal<any[]>([]);
  reviews = signal<any[]>([]);
  prompts = signal<any[]>([]);
  models = signal<any>(null);
  audit = signal<any>(null);
  verify = signal<any>(null);
  feedback = signal<any[]>([]);

  showCreate = signal(false);
  createBusy = signal(false);
  form = signal<any>({ titleFr: '', titleAr: '', titleEn: '', bodyFr: '', bodyAr: '', bodyEn: '', riskTier: 'T2_MEDIUM' });
  createMsg = signal<{ ok: boolean; text: string } | null>(null);

  async ngOnInit() {
    const u = await me();
    if (u) { this.user.set(u); await this.load(); }
  }

  async doLogin() {
    this.error.set('');
    try {
      const { user } = await login(this.email(), this.password());
      this.user.set(user);
      await this.load();
    } catch (e: any) { this.error.set(e.message || 'login failed'); }
  }
  doLogout() { logout(); this.user.set(null); }

  async load() {
    this.loading.set(true);
    try {
      const [d, docs, rv, pr, md, au, fb] = await Promise.all([
        api.dashboard(), api.documents(), api.reviews(), api.prompts(), api.models(), api.audit(), api.feedback(),
      ]);
      this.dash.set(d);
      this.docs.set((docs.items || docs).map((x: any) => ({
        ...x, titleFr: x.title_fr, titleAr: x.title_ar, titleEn: x.title_en,
        lifecycleState: x.lifecycle_state, currentVersionId: x.current_version_id,
      })));
      this.reviews.set((rv.items || rv).map((x: any) => ({
        ...x, subjectLabel: x.subject_label, riskTier: x.risk_tier,
        tasks: (x.tasks || []).map((t: any) => ({ ...t, assigneeRole: t.assignee_role, decidedAt: t.decided_at })),
      })));
      this.prompts.set((pr.items || pr).map((x: any) => ({ ...x, promptKey: x.code, version: x.version_no, isActive: x.state === 'ACTIVE' })));
      this.models.set({ items: (md.items || []).map((x: any) => ({ ...x, chatModel: x.model_id })), spendTodayUsd: md.spendTodayUsd, callsToday: md.callsToday });
      this.audit.set((au.items || au).map((x: any) => ({ ...x, createdAt: x.occurred_at, subjectType: x.subject_type, subjectId: x.subject_id, eventHash: x.hash })));
      this.feedback.set((fb.items || fb).map((x: any) => ({ ...x, messageId: x.message_id })));
      this.verify.set(await api.auditVerify());
    } catch (e: any) { this.error.set(e.message || 'load failed'); }
    this.loading.set(false);
  }

  async switchTab(t: Tab) { this.tab.set(t); if (['audit', 'reviews'].includes(t)) await this.load(); }

  async create() {
    this.createBusy.set(true);
    this.createMsg.set(null);
    try {
      const r = await api.createDocument(this.form());
      this.createMsg.set({ ok: true, text: `Créé — ${r.id}` });
      this.showCreate.set(false);
      await this.load();
    } catch (e: any) { this.createMsg.set({ ok: false, text: e.message }); }
    this.createBusy.set(false);
  }
  async submit(id: string) {
    try { await api.submitReview(id, 'T2_MEDIUM'); await this.load(); }
    catch (e: any) { alert(e.message); }
  }
  async publish(id: string) {
    try { await api.publish(id); await this.load(); }
    catch (e: any) { alert(e.message); }
  }
  async decide(id: string, decision: string) {
    const comments = decision === 'APPROVE' ? 'Validé en console' : '';
    try { await api.decision(id, decision, comments); await this.load(); }
    catch (e: any) { alert(e.message); }
  }

  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'dashboard', label: 'Tableau de bord' }, { id: 'documents', label: 'Documents' },
    { id: 'reviews', label: 'Revues Sharia' }, { id: 'models', label: 'Modèles & Prompts' }, { id: 'audit', label: 'Audit' },
  ];
  hashOf(e: any): string { return e.eventHash || e.hash || e.payloadHash || '—'; }
  hasPending(r: any): boolean { return (r.tasks || []).some((t: any) => !t.decision); }
}
