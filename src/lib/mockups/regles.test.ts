import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import {
  lireImpression, lireTaille, tailleDansNom, rangTaille, teinteReglee, trouverFichier,
  axeSymetrique, elargir, hauteurMax, placerMotif, placerPoitrine, planifierApercus, profilSuivi, profilsDepuisExistants,
  fichiersImpression, demandesImpression, fichierDemande, bornesDessin, avec300dpi, cleMotif, carteOmbres, roleDuFichier, motifDuTitre,
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

test('profilsDepuisExistants fond une grille partielle dans la complète, écarte les grilles décroissantes', () => {
  const complete = { XS: 'B-MEDIUM', S: 'C-LARGE', M: 'D-MAX', L: 'D-MAX', XL: 'D-MAX' } as const;
  const profils = profilsDepuisExistants([
    { modele: 'CRAFTER', tailles: { S: 'C-LARGE', M: 'D-MAX', L: 'D-MAX' } },
    { modele: 'CRAFTER', tailles: { ...complete } },
    { modele: 'DRUMMER', tailles: { S: 'C-LARGE', M: 'D-MAX', L: 'D-MAX' } }, // autre modèle : ne se fond pas
    { modele: 'CRAFTER', tailles: { S: 'C-LARGE', M: 'D-MAX', L: 'C-LARGE' } }, // décroissante : une erreur, pas un profil
    { modele: 'CRAFTER', tailles: { S: 'C-LARGE', M: 'D-MAX', L: 'C-LARGE' } },
  ]);
  assert.deepEqual(profils, [{ modele: 'CRAFTER', nom: 'D-Max dès M', grille: complete }]);
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

test('carteOmbres : tissu moyen = 128, écarts multipliés, fond transparent ignoré', () => {
  // 3 px : tissu gris 30, pli gris 40, fond transparent blanc
  const rgba = new Uint8ClampedArray([30, 30, 30, 255, 40, 40, 40, 255, 255, 255, 255, 0]);
  const carte = carteOmbres(rgba, 3, { x: 0, y: 0, hauteur: 100 }, 3);
  assert.equal(carte[0], 113); // 128 + (30 - 35) × 3
  assert.equal(carte[4], 143); // 128 + (40 - 35) × 3
  assert.equal(carte[8], 255); // borné
  assert.equal(carte[3], 255);
  assert.equal(carteOmbres(rgba, 3, { x: 0, y: 0, hauteur: 100 }, 0)[4], 128); // intensité 0 = neutre
});

test('roleDuFichier et motifDuTitre', () => {
  assert.equal(roleDuFichier('LOKI CLAIR.svg'), 'CLAIR');
  assert.equal(roleDuFichier('SOMBRE.png'), 'SOMBRE'); // nom rangé dans IVY
  assert.equal(roleDuFichier('LOKI DTG-CUI MARQUE.png'), null);
  assert.equal(roleDuFichier('LOKI COEUR.png'), null);
  assert.equal(motifDuTitre('Loki | T-shirt unisexe'), 'LOKI');
  assert.equal(motifDuTitre("L'esprit de l’Ours | Sweatshirt à capuche"), "L'ESPRIT DE L’OURS");
  assert.equal(motifDuTitre('T-shirt officiel festival Yggdrasil 2025'), null);
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

test('elargir : l’axe tombe au milieu, le dessin est décalé du côté court', () => {
  assert.deepEqual(elargir(1000, 0.5), { largeur: 1000, decalage: 0 });
  assert.deepEqual(elargir(1000, 0.4), { largeur: 1200, decalage: 200 }); // axe à gauche : marge à gauche
  assert.deepEqual(elargir(1000, 0.6), { largeur: 1200, decalage: 0 });   // axe à droite : marge à droite
  const { largeur, decalage } = elargir(1000, 0.45);
  assert.equal(decalage + 450, largeur / 2);
});

test('axeSymetrique : retrouve le milieu d’un cadre malgré un élément qui déborde à droite', () => {
  const l = 100, h = 60, alpha = new Uint8ClampedArray(l * h);
  const plein = (x0: number, x1: number, y0: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) alpha[y * l + x] = 255;
  };
  plein(0, 4, 0, 60); plein(76, 80, 0, 60); plein(0, 80, 0, 4); plein(0, 80, 56, 60); // cadre de 0 à 80 : milieu à 40
  plein(80, 100, 30, 34); // la queue qui déborde
  assert.equal(Math.round(axeSymetrique(alpha, l, h) * l), 40);
});

test('demandesImpression : l impression de la commande fait foi, un fichier par nom, retrouvable par fichierDemande', () => {
  // Taille écrite comme sur la commande (« C-Large ») : la demande la garde telle quelle.
  const lignes = [
    { recto: 'DTG-CUI', verso: null, taille: 'C-Large' },
    { recto: 'DTG-CUI', verso: null, taille: 'C-LARGE' },
    { recto: 'MARQUE-TSHIRT-VR1', verso: 'DTG-VR1', taille: 'D-Max' },
  ];
  const demandes = demandesImpression('LOKI', lignes, R, F);
  assert.deepEqual(demandes.map((d) => d.nom), ['LOKI DTG-CUI C-LARGE.png', 'LOKI DTG-VR1 D-MAX.png', 'LOKI DTG-VR1 MARQUE.png']);
  assert.deepEqual(demandes[0], { motif: 'LOKI', nom: 'LOKI DTG-CUI C-LARGE.png', recto: 'DTG-CUI', verso: null, taille: 'C-Large' });
  assert.equal(fichierDemande(demandes[1], R, F)?.hauteurCm, 45.7);
  assert.equal(fichierDemande({ ...demandes[0], nom: 'LOKI DTG-CUI D-MAX.png' }, R, F), null); // nom qui ne vient pas de cette impression
});
