import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { BASE, adresseAutorisee, adresseExterne, cheminCache } from './regles.ts';

test('adresseExterne : seulement un site web, jamais un programme', () => {
  assert.equal(adresseExterne('https://runesdechene.com/products/loki'), 'https://runesdechene.com/products/loki');
  assert.equal(adresseExterne('http://exemple.com/'), 'http://exemple.com/');
  for (const u of ['file:///C:/Windows/System32/calc.exe', 'ms-settings:', 'javascript:alert(1)', 'mailto:a@b.c', 'pas une adresse'])
    assert.equal(adresseExterne(u), null, u);
});

test('adresseAutorisee', () => {
  for (const p of ['/', '/login', '/ivy/commandes', '/ivy/commandes/boutique?x=1', '/ivy/commandes/boutique/facturation',
    '/ivy/commandes/stock/abc/impression', '/parametres/couleurs', '/ivy/profil', '/ivy/standard'])
    assert.equal(adresseAutorisee(BASE + p), true, p);
  for (const u of [BASE + '/ivy/inventaire', BASE + '/ivy/inventaire/mockups', BASE + '/ivy/stand', BASE + '/ivy/stand/zones',
    BASE + '/ivy/hub/x', 'https://evil.example/ivy/commandes/boutique', 'http://ivy.runesdechene.com/'])
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
