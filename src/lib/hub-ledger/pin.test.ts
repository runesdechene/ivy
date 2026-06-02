import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPin, verifyPin } from './pin.ts';

test('hashPin produit un format scrypt$salt$hash et n\'est pas le PIN en clair', () => {
  const h = hashPin('1234');
  assert.match(h, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.ok(!h.includes('1234'));
});

test('verifyPin accepte le bon PIN', () => {
  const h = hashPin('4271');
  assert.equal(verifyPin('4271', h), true);
});

test('verifyPin rejette le mauvais PIN', () => {
  const h = hashPin('4271');
  assert.equal(verifyPin('0000', h), false);
});

test('deux hash du même PIN diffèrent (sel aléatoire)', () => {
  assert.notEqual(hashPin('1234'), hashPin('1234'));
});

test('verifyPin rejette un hash au segment vide (anti-bypass)', () => {
  assert.equal(verifyPin('1234', 'scrypt$aabbcc$'), false);
});

test('verifyPin rejette un hash non-hexadécimal', () => {
  assert.equal(verifyPin('1234', 'scrypt$aabb$ZZZZ'), false);
});

test('verifyPin rejette un format à mauvais nombre de segments', () => {
  assert.equal(verifyPin('1234', 'scrypt$aabbcc'), false);
});

test('verifyPin rejette un mauvais préfixe d\'algorithme', () => {
  assert.equal(verifyPin('1234', 'bcrypt$aabb$ccdd'), false);
});

test('verifyPin accepte toujours un hash légitime après le fix', () => {
  const h = hashPin('9999');
  assert.equal(verifyPin('9999', h), true);
  assert.equal(verifyPin('8888', h), false);
});
