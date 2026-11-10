import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import {
  lireImpression, lireTaille, tailleDansNom, rangTaille, teinteReglee, trouverFichier,
  hauteurMax, placerMotif, placerPoitrine, planifierApercus, profilSuivi, profilsDepuisExistants,
  fichiersImpression, bornesDessin, avec300dpi, cleMotif,
} from './regles.ts';
import type { Reglages, FicheMotif, Cadre, Gabarit, VarianteImpression, Profil, Rect } from './regles.ts';

const r = (n: number) => Math.round(n * 10) / 10;
const rr = (x: Rect) => ({ x: r(x.x), y: r(x.y), w: r(x.w), h: r(x.h) });

const R: Reglages = {
  teintes: {
    CUI: { couleur: '#c0b090', version: 'SOMBRE' },
    OPA: { couleur: '#f0f0f0', version: 'SOMBRE' },
    VR1: { couleur: '#202020', version: 'CLAIR' },
    DOR: { couleur: null, version: 'SOMBRE' },
  },
  opacite: 0.75,
};
const F: FicheMotif = { nom: 'LOKI', hauteurs: { 'C-LARGE': 44.2, 'D-MAX': 45.7 } };
const C: Cadre = { x: 100, y: 200, hauteur: 495 }; // 10 px par cm

function gabarit(modele: string, couleur: string, face: 'recto' | 'verso', id: string, poitrine: { x: number; y: number } | null = null): Gabarit {
  return { id, modele, couleur, face, photo_url: '', ombres: { CLAIR: null, SOMBRE: null }, cadre: C, poitrine };
}
function variante(v: Partial<VarianteImpression>): VarianteImpression {
  return { id: '', shopifyId: '', couleur: 'Noir', tailleVetement: null, sku: 'CRAFTER', recto: null, verso: null, taille: null, ...v };
}

test('lireImpression distingue motif, logo DTF de veste et marque', () => {
  assert.deepEqual(lireImpression('DTG-CUI', 'recto'), { pose: 'motif', teinte: 'CUI' });
  assert.deepEqual(lireImpression('DTF-VR2', 'recto'), { pose: 'dtf', teinte: 'VR2' });
  assert.deepEqual(lireImpression('DTF-CUI', 'verso'), { pose: 'motif', teinte: 'CUI' });
  assert.deepEqual(lireImpression('MARQUE-OPA', 'recto'), { pose: 'marque', teinte: 'OPA', support: 'UNI' });
  assert.deepEqual(lireImpression('MARQUE-TSHIRT-VR1', 'recto'), { pose: 'marque', teinte: 'VR1', support: 'TSHIRT' });
  assert.deepEqual(lireImpression('MARQUE-OR', 'recto'), { pose: 'marque', teinte: 'OR', support: 'UNI' });
  assert.equal(lireImpression(null, 'recto'), null);
  assert.equal(lireImpression('', 'recto'), null);
  assert.equal(lireImpression('n importe quoi', 'recto'), null);
});

test('tailles : métachamp, nom de fichier, ordre des tailles de vêtement', () => {
  assert.equal(lireTaille('D-Max'), 'D-MAX');
  assert.equal(lireTaille('A-Small'), 'A-SMALL');
  assert.equal(lireTaille('XL'), null);
  assert.equal(tailleDansNom('LOKI CUI C-LARGE.png'), 'C-LARGE');
  assert.equal(tailleDansNom('LOKI DTG-CUI D-MAX.png'), 'D-MAX');
  assert.equal(tailleDansNom('LOKI CLAIR.png'), null);
  assert.equal(rangTaille('XXL'), rangTaille('2XL'));
  assert.ok(rangTaille('S') < rangTaille('M'));
  assert.equal(rangTaille('Unique'), -1);
});

test('teinteReglee exige une couleur et une version', () => {
  assert.equal(teinteReglee(R, 'DOR'), null);
  assert.equal(teinteReglee(R, 'ZZZ'), null);
  assert.deepEqual(teinteReglee(R, 'CUI'), { couleur: '#c0b090', version: 'SOMBRE' });
});

test('trouverFichier prend la source de la version, ignore cachés, autres formats et fichiers d impression', () => {
  const noms = ['LOKI CLAIR.png', 'LOKI SOMBRE.png', 'LOKI MARQUE.png', '.LOKI CLAIR.png', 'LOKI SOMBRE.psd', 'LOKI DTG-CUI MARQUE.png', 'LOKI DTG-CUI D-MAX.png', 'LOKI DTF-OPA COEUR.png'];
  assert.equal(trouverFichier(noms, { pose: 'motif', teinte: 'VR1' }, R), 'LOKI CLAIR.png');
  assert.equal(trouverFichier(noms, { pose: 'motif', teinte: 'CUI' }, R), 'LOKI SOMBRE.png');
  assert.equal(trouverFichier(noms, { pose: 'marque', teinte: 'CUI', support: 'UNI' }, R), 'LOKI MARQUE.png');
  assert.equal(trouverFichier(noms, { pose: 'dtf', teinte: 'CUI' }, R), null);
  assert.equal(trouverFichier(['LOKI DTF.png'], { pose: 'dtf', teinte: 'CUI' }, R), 'LOKI DTF.png');
  assert.equal(trouverFichier(['LOKI CLAIR.png'], { pose: 'motif', teinte: 'CUI' }, R), null);
  assert.equal(trouverFichier(['LOKI SOMBRE.psd'], { pose: 'motif', teinte: 'CUI' }, R), null);
  assert.equal(trouverFichier(['LOKI CLAIR.svg', 'LOKI SOMBRE.svg'], { pose: 'motif', teinte: 'CUI' }, R), 'LOKI SOMBRE.svg');
});

test('hauteurMax respecte 49,5 cm de haut et 40,64 cm de large', () => {
  assert.equal(r(hauteurMax(4200, 5906)), 49.5);
  assert.equal(r(hauteurMax(4200, 3050)), 29.5);
});

test('placerMotif : hauteur réglée, largeur en proportion, centré, collé en haut', () => {
  assert.deepEqual(rr(placerMotif(C, 4200, 5906, 45.7)), { x: 140.7, y: 200, w: 325, h: 457 });
  const paysage = rr(placerMotif(C, 4200, 3050, 25.8));
  assert.equal(paysage.h, 258);
  assert.equal(paysage.w, 355.3);
  assert.equal(paysage.y, 200);
});

test('placerPoitrine pose à la taille réelle, haut-centre sur le point', () => {
  assert.deepEqual(rr(placerPoitrine(C, { x: 300, y: 250 }, 2174, 520)), { x: 208, y: 250, w: 184.1, h: 44 });
});

test('planifierApercus : une entrée par couleur et face, premier manque', () => {
  const variantes = [
    variante({ couleur: 'Noir', recto: 'DTG-CUI' }),
    variante({ couleur: 'Noir', recto: 'DTG-CUI' }),
    variante({ couleur: 'Desert', recto: 'DTG-VR1' }),
    variante({ couleur: 'Kaki', sku: null, recto: 'DTG-OPA' }),
  ];
  const gabarits = [gabarit('CRAFTER', 'Noir', 'recto', 'g1')];
  const a = planifierApercus(variantes, ['recto', 'verso'], gabarits, ['HECATE SOMBRE.png'], R, F, 'D-MAX');
  assert.equal(a.length, 2);
  assert.deepEqual([a[0].couleur, a[0].face, a[0].gabaritId, a[0].fichier, a[0].manque], ['Noir', 'recto', 'g1', 'HECATE SOMBRE.png', null]);
  assert.deepEqual([a[1].couleur, a[1].manque], ['Desert', 'gabarit']);
  assert.deepEqual(planifierApercus(variantes, ['verso'], gabarits, ['HECATE SOMBRE.png'], R, F, 'D-MAX'), []);
  assert.equal(planifierApercus(variantes, ['recto'], gabarits, ['HECATE SOMBRE.png'], R, F, 'A-SMALL')[0].manque, 'hauteur');
});

test('planifierApercus : marque sans point poitrine, logo DTF commun', () => {
  const v = [variante({ sku: 'DRUMMER 2.0', recto: 'MARQUE-CUI', verso: 'DTG-OPA' })];
  const g = [gabarit('DRUMMER 2.0', 'Noir', 'recto', 'r'), gabarit('DRUMMER 2.0', 'Noir', 'verso', 'v')];
  const a = planifierApercus(v, ['recto', 'verso'], g, ['LOKI MARQUE.png', 'LOKI SOMBRE.png'], R, F, 'D-MAX');
  assert.equal(a[0].manque, 'poitrine');
  assert.deepEqual([a[1].manque, a[1].fichier], [null, 'LOKI SOMBRE.png']);

  const veste = [variante({ sku: 'CULTIVATOR 2.0', recto: 'DTF-CUI' })];
  const gv = [gabarit('CULTIVATOR 2.0', 'Noir', 'recto', 'c', { x: 300, y: 250 })];
  const b = planifierApercus(veste, ['recto'], gv, ['LOKI SOMBRE.png'], R, F, 'D-MAX');
  assert.deepEqual([b[0].manque, b[0].fichier], [null, null]);
});

test('planifierApercus : teinte non réglée', () => {
  const g = [gabarit('CRAFTER', 'Noir', 'recto', 'g')];
  for (const recto of ['DTG-DOR', 'DTG-ZZZ']) {
    const a = planifierApercus([variante({ recto })], ['recto'], g, ['X CLAIR.png', 'X SOMBRE.png'], R, F, 'D-MAX');
    assert.equal(a[0].manque, 'teinte');
  }
});

test('profilsDepuisExistants garde les grilles partagées par au moins deux produits', () => {
  const dM = { S: 'C-LARGE', M: 'D-MAX', L: 'D-MAX' } as const;
  const dXL = { M: 'C-LARGE', L: 'C-LARGE', XL: 'D-MAX' } as const;
  const profils = profilsDepuisExistants([
    { modele: 'CRAFTER', tailles: { ...dM } },
    { modele: 'CRAFTER', tailles: { ...dM } },
    { modele: 'CRAFTER', tailles: { S: 'B-MEDIUM', M: 'C-LARGE', L: 'D-MAX' } },
    { modele: 'CRAFTER', tailles: { ...dXL } },
    { modele: 'CRAFTER', tailles: { ...dXL } },
  ]);
  assert.deepEqual(profils, [
    { modele: 'CRAFTER', nom: 'D-Max dès M', grille: dM },
    { modele: 'CRAFTER', nom: 'D-Max dès XL', grille: dXL },
  ]);
});

test('profilSuivi trouve le profil du même modèle qui couvre chaque taille', () => {
  const p: Profil = { id: 'p', modele: 'CRAFTER', nom: 'D-Max dès M', grille: { S: 'C-LARGE', M: 'D-MAX', L: 'D-MAX' } };
  assert.equal(profilSuivi('CRAFTER', { S: 'C-LARGE', M: 'D-MAX' }, [p]), p);
  assert.equal(profilSuivi('CRAFTER', { S: 'C-LARGE', M: 'C-LARGE' }, [p]), null);
  assert.equal(profilSuivi('DRUMMER 2.0', { S: 'C-LARGE', M: 'D-MAX' }, [p]), null);
});

test('fichiersImpression : noms de l atelier, hauteurs de la fiche, sans doublon', () => {
  const variantes = [
    variante({ recto: 'DTG-CUI', taille: 'C-LARGE' }),
    variante({ recto: 'DTG-CUI', taille: 'D-MAX' }),
    variante({ recto: 'DTG-CUI', taille: 'D-MAX' }),
    variante({ recto: 'MARQUE-TSHIRT-VR1', verso: 'DTG-VR1', taille: 'D-MAX' }),
    variante({ recto: 'DTF-OPA' }),
    variante({ recto: 'DTG-CUI', taille: 'A-SMALL' }),
    variante({ recto: 'DTG-DOR', taille: 'D-MAX' }),
  ];
  assert.deepEqual(fichiersImpression('LOKI', variantes, R, F), [
    { nom: 'LOKI DTF-OPA COEUR.png', source: 'DTF', teinte: 'OPA', hauteurCm: null },
    { nom: 'LOKI DTG-CUI C-LARGE.png', source: 'SOMBRE', teinte: 'CUI', hauteurCm: 44.2 },
    { nom: 'LOKI DTG-CUI D-MAX.png', source: 'SOMBRE', teinte: 'CUI', hauteurCm: 45.7 },
    { nom: 'LOKI DTG-VR1 D-MAX.png', source: 'CLAIR', teinte: 'VR1', hauteurCm: 45.7 },
    { nom: 'LOKI DTG-VR1 MARQUE.png', source: 'MARQUE', teinte: 'VR1', hauteurCm: null },
  ]);
});

test('bornesDessin : rectangle des pixels non transparents', () => {
  const alpha = new Uint8ClampedArray(5 * 4);
  alpha[1 * 5 + 1] = 255;
  alpha[2 * 5 + 3] = 10;
  assert.deepEqual(bornesDessin(alpha, 5, 4), { x: 1, y: 1, w: 3, h: 2 });
  assert.equal(bornesDessin(new Uint8ClampedArray(20), 5, 4), null);
});

test('cleMotif : majuscules, sans accents, espaces simples', () => {
  assert.equal(cleMotif('Hécate'), 'HECATE');
  assert.equal(cleMotif("L'esprit de la loutre"), "L'ESPRIT DE LA LOUTRE");
  assert.equal(cleMotif('  Varègue '), 'VAREGUE');
});

test('avec300dpi insère un seul bloc pHYs à 300 dpi, CRC correct', () => {
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  const sortie = avec300dpi(avec300dpi(png));
  const vue = Buffer.from(sortie);
  assert.equal(vue.toString('latin1', 37, 41), 'pHYs');               // juste après IHDR (8 + 25 + 4)
  assert.equal(vue.readUInt32BE(33), 9);
  assert.deepEqual([...vue.subarray(41, 50)], [0x00, 0x00, 0x2e, 0x23, 0x00, 0x00, 0x2e, 0x23, 0x01]);
  assert.equal(vue.readUInt32BE(50), crc32(vue.subarray(37, 50)));
  assert.equal(vue.toString('latin1').split('pHYs').length - 1, 1);
});
