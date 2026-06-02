import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const KEYLEN = 64;

/** Hash salé d'un PIN. Format: scrypt$<saltHex>$<hashHex>. Jamais réversible. */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Vérifie un PIN contre un hash stocké (comparaison à temps constant). */
export function verifyPin(pin: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[2], 'hex');
  if (expected.length !== KEYLEN) return false;
  const salt = Buffer.from(parts[1], 'hex');
  if (salt.length === 0) return false;
  const actual = scryptSync(pin, salt, KEYLEN);
  return timingSafeEqual(expected, actual);
}
