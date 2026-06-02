import { NextRequest } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyUnlockToken } from './unlock-token';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export interface AuthResult {
  userId: string;
  shopIds: string[];
  svc: SupabaseClient; // client service_role
}

/** Valide le JWT Supabase (header Authorization: Bearer) et résout les shops du user. */
export async function authorizeRequest(
  request: NextRequest
): Promise<{ ok: true; auth: AuthResult } | { ok: false; status: number; error: string }> {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false, status: 401, error: 'Non authentifié' };

  const anon = createClient(URL, ANON);
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401, error: 'Session invalide' };

  const svc = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: rows, error: msErr } = await svc
    .from('user_shops')
    .select('shop_id')
    .eq('user_id', data.user.id);
  if (msErr) return { ok: false, status: 500, error: msErr.message };

  const shopIds = (rows ?? []).map((r) => r.shop_id as string);
  return { ok: true, auth: { userId: data.user.id, shopIds, svc } };
}

/** Vérifie qu'un shopId demandé appartient bien au user. */
export function ownsShop(auth: AuthResult, shopId: string): boolean {
  return auth.shopIds.includes(shopId);
}

/** Vérifie le jeton de déverrouillage PIN (header x-unlock-token). Requis pour servir des montants. */
export function requireUnlock(request: NextRequest, userId: string): boolean {
  const token = request.headers.get('x-unlock-token');
  if (!token) return false;
  return verifyUnlockToken(token, userId, Date.now());
}
