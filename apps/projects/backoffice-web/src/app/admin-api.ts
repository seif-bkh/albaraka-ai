/** Admin API client — Bearer token in localStorage, contract: specs/openapi.yaml /api/v1/admin. */
export interface Me { id: string; email: string; name?: string; roles: string[]; }

const TOKEN_KEY = 'al-mouchir-admin-token';
export const token = () => localStorage.getItem(TOKEN_KEY) || '';

export async function login(email: string, password: string): Promise<{ accessToken: string; user: Me }> {
  const r = await fetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  localStorage.setItem(TOKEN_KEY, j.accessToken);
  return j;
}
export async function me(): Promise<Me | null> {
  if (!token()) return null;
  const r = await fetch('/api/v1/auth/me', { headers: { Authorization: `Bearer ${token()}` } });
  if (!r.ok) { localStorage.removeItem(TOKEN_KEY); return null; }
  return r.json();
}
export function logout() { localStorage.removeItem(TOKEN_KEY); }

async function req<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
      ...(init.headers || {}),
    },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  return j;
}
export const api = {
  dashboard: () => req<any>('/api/v1/admin/dashboard'),
  documents: () => req<any>('/api/v1/admin/documents'),
  createDocument: (body: any) => req<any>('/api/v1/admin/documents', { method: 'POST', body: JSON.stringify(body) }),
  submitReview: (id: string, riskTier: string) => req<any>(`/api/v1/admin/documents/${id}/submit-review`, { method: 'POST', body: JSON.stringify({ riskTier }) }),
  publish: (id: string) => req<any>(`/api/v1/admin/documents/${id}/publish`, { method: 'POST' }),
  reviews: () => req<any>('/api/v1/admin/reviews'),
  decision: (id: string, decision: string, comments?: string) => req<any>(`/api/v1/admin/reviews/${id}/decision`, { method: 'POST', body: JSON.stringify({ decision, comments }) }),
  prompts: () => req<any>('/api/v1/admin/prompts'),
  models: () => req<any>('/api/v1/admin/models'),
  retrievalConfig: () => req<any>('/api/v1/admin/retrieval-config'),
  activateRetrieval: (id: string) => req<any>(`/api/v1/admin/retrieval-config/${id}/activate`, { method: 'POST' }),
  audit: () => req<any>('/api/v1/admin/audit'),
  auditVerify: () => req<any>('/api/v1/admin/audit/verify'),
  feedback: () => req<any>('/api/v1/admin/feedback'),
};
