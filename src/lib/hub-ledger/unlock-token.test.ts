import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_LEDGER_SECRET = 'test-secret-please-change';
const { issueUnlockToken, verifyUnlockToken, TTL_MS } = await import('./unlock-token.ts');

const NOW = 1_000_000;

test('un jeton fraîchement émis est valide pour le bon user', () => {
  const t = issueUnlockToken('user-1', NOW);
  assert.equal(verifyUnlockToken(t, 'user-1', NOW + 1000), true);
});

test('rejette un autre user', () => {
  const t = issueUnlockToken('user-1', NOW);
  assert.equal(verifyUnlockToken(t, 'user-2', NOW + 1000), false);
});

test('rejette un jeton expiré', () => {
  const t = issueUnlockToken('user-1', NOW);
  assert.equal(verifyUnlockToken(t, 'user-1', NOW + TTL_MS + 1), false);
});

test('rejette une signature altérée', () => {
  const t = issueUnlockToken('user-1', NOW);
  assert.equal(verifyUnlockToken(t.slice(0, -2) + 'xy', 'user-1', NOW + 1000), false);
});
