import { authFetch } from '@/lib/auth-fetch';

/** Récupère le jeton de déverrouillage PIN courant (déposé par usePinLock). */
function unlockToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('hub_comptes_unlock');
}

/** fetch authentifié (Bearer JWT) + le jeton de déverrouillage PIN. */
export async function hubFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const ut = unlockToken();
  if (ut) headers.set('x-unlock-token', ut);
  return authFetch(input, { ...init, headers });
}

export async function hubJson<T>(input: string, init?: RequestInit): Promise<T> {
  const r = await hubFetch(input, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error || `Erreur ${r.status}`);
  return body as T;
}
