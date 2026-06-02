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
