import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { BASE, adresseAutorisee, cheminCache } from './regles.ts';

test('adresseAutorisee', () => {
  for (const p of ['/', '/login', '/ivy/commandes/boutique', '/ivy/commandes/boutique?x=1', '/ivy/commandes/stock',
    '/ivy/commandes/stock/17258688-6e46-475f-9445-75a2135900f0', '/ivy/commandes/stock/abc/impression', '/ivy/commandes/stock/abc/feuillet'])
    assert.equal(adresseAutorisee(BASE + p), true, p);
  for (const u of [BASE + '/ivy/commandes/boutique/facturation', BASE + '/ivy/inventaire/mockups', BASE + '/ivy/commandes',
    BASE + '/ivy/commandes/stock/abc/autre', 'https://evil.example/ivy/commandes/boutique', 'http://ivy.runesdechene.com/'])
    assert.equal(adresseAutorisee(u), false, u);
});

test('adresseAutorisee : autre adresse d IVY en développement', () => {
  assert.equal(adresseAutorisee('http://localhost:3000/ivy/commandes/stock', 'http://localhost:3000'), true);
  assert.equal(adresseAutorisee(BASE + '/ivy/commandes/stock', 'http://localhost:3000'), false);
});

test('cheminCache', () => {
  const s = 'https://monessruufklcrrhzvub.supabase.co/storage/v1/object/sign/impression/99c/LOKI/LOKI-DTG-OPA-C-LARGE.0123456789abcdef.png?token=t';
  assert.equal(cheminCache(s, 'LOKI DTG-OPA C-LARGE.png', 'C:\\c'), path.join('C:\\c', '0123456789abcdef', 'LOKI DTG-OPA C-LARGE.png'));
  assert.equal(cheminCache(s.replace('/impression/', '/mockups/'), 'x.png', 'C:\\c'), null);
  assert.equal(cheminCache('https://autre.example/storage/v1/object/sign/impression/a.0123456789abcdef.png', 'x.png', 'C:\\c'), null);
  assert.equal(cheminCache(s.replace('.0123456789abcdef', ''), 'x.png', 'C:\\c'), null);
  assert.equal(cheminCache(s, '..\\x.png', 'C:\\c'), null);
});
