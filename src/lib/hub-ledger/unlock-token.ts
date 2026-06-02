import { createHmac, timingSafeEqual } from 'crypto';

export const TTL_MS = 15 * 60 * 1000; // 15 min

// Secret serveur dédié, fallback sur la service role key (jamais exposée au client).
function secret(): string {
  const s = process.env.HUB_LEDGER_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error('Missing HUB_LEDGER_SECRET / SUPABASE_SERVICE_ROLE_KEY');
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Émet un jeton de déverrouillage signé, lié au user et expirant après TTL_MS. */
export function issueUnlockToken(userId: string, now: number): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: now + TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Vérifie signature + appartenance user + expiration. */
export function verifyUnlockToken(token: string, userId: string, now: number): boolean {
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return uid === userId && typeof exp === 'number' && exp > now;
  } catch {
    return false;
  }
}
