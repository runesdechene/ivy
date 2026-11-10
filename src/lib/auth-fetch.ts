import { supabase } from '@/supabase/client';

/** fetch authentifié : ajoute le jeton de session Supabase (Bearer) attendu par `authorizeRequest`. */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session?.access_token) headers.set('Authorization', `Bearer ${data.session.access_token}`);
  return fetch(input, { ...init, headers });
}

/** authFetch qui renvoie le JSON, ou lève l'erreur renvoyée par la route. */
export async function authJson<T>(input: string, init?: RequestInit): Promise<T> {
  const r = await authFetch(input, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error || `Erreur ${r.status}`);
  return body as T;
}
