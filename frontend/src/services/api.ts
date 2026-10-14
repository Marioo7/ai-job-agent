import { DEMO, auth } from './firebase';

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:8080';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function token(): Promise<string> {
  if (DEMO) return 'demo';
  const u = auth?.currentUser;
  if (!u) throw new ApiError(401, 'unauthenticated', 'Sign in required.');
  return u.getIdToken();
}

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await token()}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let res: Response;
  try { res = await fetch(`${BASE}/api${path}`, { ...init, headers }); }
  catch { throw new ApiError(0, 'network', 'Cannot reach the server. Is the backend running?'); }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    throw new ApiError(res.status, j.error?.code ?? 'error', j.error?.message ?? `Request failed (${res.status})`);
  }
  return res;
}

export const api = {
  get: async <T,>(p: string): Promise<T> => (await raw(p)).json() as Promise<T>,
  post: async <T,>(p: string, body?: unknown): Promise<T> => (await raw(p, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })).json() as Promise<T>,
  put: async <T,>(p: string, body: unknown): Promise<T> => (await raw(p, { method: 'PUT', body: JSON.stringify(body) })).json() as Promise<T>,
  patch: async <T,>(p: string, body: unknown): Promise<T> => (await raw(p, { method: 'PATCH', body: JSON.stringify(body) })).json() as Promise<T>,
  del: async <T,>(p: string): Promise<T> => (await raw(p, { method: 'DELETE' })).json() as Promise<T>,
  upload: async <T,>(p: string, form: FormData): Promise<T> => (await raw(p, { method: 'POST', body: form })).json() as Promise<T>,
  blob: async (p: string): Promise<Blob> => (await raw(p)).blob(),
};
