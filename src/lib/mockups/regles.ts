/**
 * Règles du module Mockups — fonctions pures, sans import, testées par `node --test`.
 *
 * Vocabulaire :
 * - teinte : CUI, OPA, VR1… lue dans les métachamps de variante (« DTG-CUI ») ;
 * - version : CLAIR ou SOMBRE, le dessin à prendre pour une teinte (réglage IVY) ;
 * - taille d'impression : A-SMALL … D-MAX ; sa hauteur en cm vient de la fiche du motif ;
 * - cadre : la zone d'impression maximale (49,5 × 40,64 cm) posée sur la photo du gabarit.
 */

export type Face = 'recto' | 'verso';
export type Version = 'CLAIR' | 'SOMBRE';
export type TailleImpression = 'A-SMALL' | 'B-MEDIUM' | 'C-LARGE' | 'D-MAX';
export type Impression =
  | { pose: 'motif'; teinte: string }                                  // DTG-xxx, et DTF-xxx au verso
  | { pose: 'dtf'; teinte: string }                                    // DTF-xxx au recto : logo de veste
  | { pose: 'marque'; teinte: string; support: 'UNI' | 'TSHIRT' };
export interface Reglages {
  teintes: Record<string, { couleur: string | null; version: Version | null }>;
  opacite: number; // encre sur les mockups, 0–1 ; les fichiers d'impression restent pleins
}
/** `axe` : où tombe le centre voulu du motif (souvent le milieu de son cadre), en fraction de la largeur du dessin ; null = au milieu. */
export interface FicheMotif { nom: string; hauteurs: Partial<Record<TailleImpression, number>>; axe?: number | null }
export interface FichierDepose { url: string; taille: number; depose_le: string; ext: 'png' | 'svg' }
/** Un motif tel qu'IVY le connaît : nom affiché, fiche de tailles (`nom` = clé), fichiers déposés, nombre de produits. */
export interface Motif extends FicheMotif { libelle: string; fichiers: Partial<Record<Role, FichierDepose>>; produits: number }
export interface Cadre { x: number; y: number; hauteur: number }
export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Gabarit {
  id: string; modele: string; couleur: string; face: Face;
  photo_url: string; ombres: Record<Version, string | null>;
  masque_url: string | null; // blanc = l'encre passe, noir = effacée (cordons…)
  intensites: Record<Version, number>; // ombres tirées de la photo quand aucun fichier n'est déposé ; 0 = aucune
  cadre: Cadre; poitrine: Point | null;
}
export interface VarianteImpression {
  id: string; shopifyId: string; couleur: string; tailleVetement: string | null; sku: string | null;
  recto: string | null; verso: string | null; taille: TailleImpression | null;
}
export interface Apercu {
  couleur: string; face: Face; modele: string; impression: Impression;
  gabaritId: string | null; fichier: string | null;
  manque: 'teinte' | 'hauteur' | 'gabarit' | 'poitrine' | 'fichier' | null;
}
export interface Profil { id: string; modele: string; nom: string; grille: Record<string, TailleImpression> }
/** `faces` : les zones du vêtement qui reçoivent ce fichier (un même fichier peut servir au recto et au verso). */
export interface FichierImpression { nom: string; source: Version | 'MARQUE' | 'DTF'; teinte: string; hauteurCm: number | null; faces: Face[] }

export const CADRE_HAUTEUR_CM = 49.5;
export const CADRE_LARGEUR_CM = 40.64; // 16 pouces
export const PX_PAR_CM_300DPI = 300 / 2.54;
export const OPACITE_ENCRE = 0.75; // valeur par défaut du réglage
export const PX_PAR_METRE_300DPI = 11811;
export const TAILLES_IMPRESSION: TailleImpression[] = ['A-SMALL', 'B-MEDIUM', 'C-LARGE', 'D-MAX'];
export const ROLES = ['CLAIR', 'SOMBRE', 'MARQUE', 'DTF'] as const; // les fichiers sources d'un motif
export type Role = (typeof ROLES)[number];
export const METACHAMPS = { recto: 'fichier_d_impression', verso: 'verso_impression', taille: 'taille_d_impression' } as const;
export const MIXTE = '(mixte)'; // les variantes d'une même couleur n'ont pas toutes la même valeur

const FACES: Face[] = ['recto', 'verso'];
const TAILLES_VETEMENT = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
const ALIAS_VETEMENT: Record<string, string> = { '2XL': 'XXL', XXXL: '3XL' };

// --- Lecture des métachamps -------------------------------------------------

export function lireImpression(valeur: string | null, face: Face): Impression | null {
  const v = (valeur ?? '').trim().toUpperCase();
  const technique = v.match(/^(DTG|DTF)-([A-Z0-9]+)$/);
  if (technique) {
    const pose = technique[1] === 'DTF' && face === 'recto' ? 'dtf' : 'motif';
    return { pose, teinte: technique[2] };
  }
  const marque = v.match(/^MARQUE-(TSHIRT-)?([A-Z0-9]+)$/);
  if (marque) return { pose: 'marque', teinte: marque[2], support: marque[1] ? 'TSHIRT' : 'UNI' };
  return null;
}

export function lireTaille(valeur: string | null): TailleImpression | null {
  const v = (valeur ?? '').trim().toUpperCase();
  return (TAILLES_IMPRESSION as string[]).includes(v) ? (v as TailleImpression) : null;
}

export function tailleDansNom(nom: string): TailleImpression | null {
  const m = nom.toUpperCase().match(/(?:^|[\s_])(A-SMALL|B-MEDIUM|C-LARGE|D-MAX)(?=[\s_.]|$)/);
  return m ? (m[1] as TailleImpression) : null;
}

/** Taille de vêtement sous une seule écriture : `2XL` → `XXL`, `XXXL` → `3XL` (Shopify a les deux). */
export function tailleVetement(taille: string): string {
  const t = taille.trim().toUpperCase();
  return ALIAS_VETEMENT[t] ?? t;
}

export function rangTaille(taille: string): number {
  return TAILLES_VETEMENT.indexOf(tailleVetement(taille));
}

export function teinteReglee(reglages: Reglages, teinte: string): { couleur: string; version: Version } | null {
  const t = reglages.teintes[teinte];
  return t?.couleur && t.version ? { couleur: t.couleur, version: t.version } : null;
}

// --- Fichiers du dossier d'un motif ------------------------------------------

/** Rôle d'un fichier source d'après le dernier mot de son nom ; `null` pour tout autre fichier. */
export function roleDuFichier(nom: string): Role | null {
  if (nom.startsWith('.') || !/\.(png|svg)$/i.test(nom)) return null;
  const base = nom.slice(0, -4).toUpperCase(); // « .png » et « .svg » font quatre caractères
  // Un fichier d'impression (« LOKI DTG-CUI MARQUE.png ») n'est pas une source.
  if (/(?:^|\s)(DTG|DTF)-/.test(base)) return null;
  const mot = base.split(/\s+/).pop() as Role;
  return ROLES.includes(mot) ? mot : null;
}

/** Le fichier source d'une impression : CLAIR / SOMBRE selon la teinte pour un motif, sinon MARQUE ou DTF. */
export function trouverFichier(noms: string[], impression: Impression, reglages: Reglages): string | null {
  const role = impression.pose === 'motif' ? teinteReglee(reglages, impression.teinte)?.version
    : impression.pose === 'marque' ? 'MARQUE' : 'DTF';
  return role ? noms.find((nom) => roleDuFichier(nom) === role) ?? null : null;
}

export function cleMotif(nom: string): string {
  return nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim().replace(/\s+/g, ' ');
}

/** Motif d'un produit : ce qui précède « | » dans son titre (« Loki | T-shirt unisexe » → « LOKI »). */
export function motifDuTitre(titre: string): string | null {
  const i = titre.indexOf(' | ');
  return i > 0 ? cleMotif(titre.slice(0, i)) : null;
}

// --- Géométrie ----------------------------------------------------------------

/**
 * Élargit un dessin de transparent du côté court pour que son axe tombe au milieu :
 * un élément qui déborde (une queue de serpent) ne décale plus le motif à l'impression.
 */
export function elargir(largeur: number, axe: number): { largeur: number; decalage: number } {
  const moitie = Math.max(axe, 1 - axe) * largeur;
  return { largeur: Math.round(2 * moitie), decalage: Math.round(moitie - axe * largeur) };
}

/**
 * L'axe (fraction de la largeur) où le dessin et son reflet en miroir se superposent le mieux :
 * pour un motif encadré, le milieu du cadre, même si un élément déborde d'un côté.
 */
export function axeSymetrique(alpha: Uint8ClampedArray, largeur: number, hauteur: number): number {
  let meilleur = 0.5, score = -1;
  for (let c2 = Math.round(largeur * 0.7); c2 <= Math.round(largeur * 1.3); c2++) { // c2 = deux fois l'axe, en pixels
    let s = 0;
    for (let y = 0; y < hauteur; y++) {
      const ligne = y * largeur;
      for (let x = Math.max(0, c2 - largeur + 1); x < Math.min(largeur, c2 + 1); x++) {
        if (alpha[ligne + x] > 127 && alpha[ligne + c2 - x] > 127) s++;
      }
    }
    if (s > score) { score = s; meilleur = c2 / 2 / largeur; }
  }
  return meilleur;
}

/** Hauteur maximale (cm) d'un dessin pour qu'il tienne dans 49,5 × 40,64 cm. */
export function hauteurMax(dessinLargeurPx: number, dessinHauteurPx: number): number {
  return Math.min(CADRE_HAUTEUR_CM, CADRE_LARGEUR_CM * dessinHauteurPx / dessinLargeurPx);
}

/** Dessin à la hauteur réglée, largeur en proportion, centré dans le cadre et collé en haut. */
export function placerMotif(cadre: Cadre, dessinLargeurPx: number, dessinHauteurPx: number, hauteurCm: number): Rect {
  const pxParCm = cadre.hauteur / CADRE_HAUTEUR_CM;
  const h = hauteurCm * pxParCm;
  const w = h * dessinLargeurPx / dessinHauteurPx;
  return { x: cadre.x + (CADRE_LARGEUR_CM * pxParCm - w) / 2, y: cadre.y, w, h };
}

/** Marque ou logo DTF à leur taille réelle (300 dpi), haut-centre sur le point poitrine. */
export function placerPoitrine(cadre: Cadre, point: Point, largeurPx: number, hauteurPx: number): Rect {
  const echelle = (cadre.hauteur / CADRE_HAUTEUR_CM) / PX_PAR_CM_300DPI;
  const w = largeurPx * echelle;
  return { x: point.x - w / 2, y: point.y, w, h: hauteurPx * echelle };
}

/** Rectangle des pixels non transparents ; `alpha` = un octet par pixel. */
export function bornesDessin(alpha: Uint8ClampedArray, largeur: number, hauteur: number): Rect | null {
  let x0 = largeur, y0 = hauteur, x1 = -1, y1 = -1;
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      if (alpha[y * largeur + x] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Carte d'ombres tirée de la photo (RGBA) : chaque gris est recentré sur 128, le neutre de la lumière crue,
 *  autour du gris moyen du tissu dans le cadre, et son écart multiplié par l'intensité. */
export function carteOmbres(rgba: Uint8ClampedArray, largeur: number, cadre: Cadre, intensite: number): Uint8ClampedArray {
  const hauteur = rgba.length / 4 / largeur;
  const gris = (i: number) => (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  const x0 = Math.max(0, Math.round(cadre.x)), y0 = Math.max(0, Math.round(cadre.y));
  const x1 = Math.min(largeur, Math.round(cadre.x + cadre.hauteur * CADRE_LARGEUR_CM / CADRE_HAUTEUR_CM));
  const y1 = Math.min(hauteur, Math.round(cadre.y + cadre.hauteur));
  let somme = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * largeur + x) * 4;
      if (rgba[i + 3] === 0) continue; // fond transparent de la photo : pas du tissu
      somme += gris(i);
      n++;
    }
  }
  const reference = n ? somme / n : 128;
  const carte = new Uint8ClampedArray(rgba.length); // Uint8ClampedArray borne seul à 0–255
  for (let i = 0; i < rgba.length; i += 4) {
    const v = 128 + (gris(i) - reference) * intensite;
    carte[i] = carte[i + 1] = carte[i + 2] = v;
    carte[i + 3] = 255;
  }
  return carte;
}

// --- Aperçus d'un produit -------------------------------------------------------

export function planifierApercus(
  variantes: VarianteImpression[], faces: Face[], gabarits: Gabarit[], fichiers: string[],
  reglages: Reglages, fiche: FicheMotif | null, taille: TailleImpression,
): Apercu[] {
  const apercus = new Map<string, Apercu>();
  for (const v of variantes) {
    if (!v.sku) continue;
    for (const face of faces) {
      const impression = lireImpression(v[face], face);
      const cle = `${v.couleur}|${face}`;
      if (!impression || apercus.has(cle)) continue;

      const g = gabarits.find((x) => x.modele === v.sku && x.couleur === v.couleur && x.face === face) ?? null;
      const fichier = trouverFichier(fichiers, impression, reglages);
      const manque: Apercu['manque'] =
        !teinteReglee(reglages, impression.teinte) ? 'teinte'
        : impression.pose === 'motif' && !fiche?.hauteurs[taille] ? 'hauteur'
        : !g ? 'gabarit'
        : impression.pose !== 'motif' && !g.poitrine ? 'poitrine'
        : !fichier && impression.pose !== 'dtf' ? 'fichier' // le DTF sans logo propre prend le logo commun
        : null;
      apercus.set(cle, { couleur: v.couleur, face, modele: v.sku, impression, gabaritId: g?.id ?? null, fichier, manque });
    }
  }
  return [...apercus.values()];
}

// --- Profils de tailles ------------------------------------------------------------

function grilleTriee(tailles: Record<string, TailleImpression>): [string, TailleImpression][] {
  return Object.entries(tailles).sort((a, b) => rangTaille(a[0]) - rangTaille(b[0]));
}

/** L'impression ne rapetisse jamais quand le vêtement grandit. */
function croissante(grille: Record<string, TailleImpression>): boolean {
  const rangs = grilleTriee(grille).map(([, t]) => TAILLES_IMPRESSION.indexOf(t));
  return rangs.every((r, i) => i === 0 || r >= rangs[i - 1]);
}

/**
 * Profils amorcés depuis Shopify : grilles croissantes portées par au moins deux produits (une seule = probable erreur).
 * Une grille contenue dans une plus complète, aux mêmes valeurs (S→XL dans XS→5XL), s'y fond : ses produits la suivent déjà.
 */
export function profilsDepuisExistants(produits: { modele: string; tailles: Record<string, TailleImpression> }[]): Omit<Profil, 'id'>[] {
  const grilles = produits
    .filter((p) => croissante(p.tailles))
    .map((p) => ({ modele: p.modele, grille: Object.fromEntries(grilleTriee(p.tailles)), n: 1 }))
    .sort((a, b) => Object.keys(b.grille).length - Object.keys(a.grille).length);
  const retenues: typeof grilles = [];
  for (const g of grilles) {
    const parent = retenues.find((r) => r.modele === g.modele && Object.entries(g.grille).every(([k, t]) => r.grille[k] === t));
    if (parent) parent.n++;
    else retenues.push(g);
  }
  const profils: Omit<Profil, 'id'>[] = [];
  for (const { modele, grille, n } of retenues) {
    if (n < 2) continue;
    const seuil = Object.entries(grille).find(([, t]) => t === 'D-MAX')?.[0];
    const base = seuil ? `D-Max dès ${seuil}` : 'Sans D-Max';
    let nom = base;
    for (let i = 2; profils.some((p) => p.modele === modele && p.nom === nom); i++) nom = `${base} (${i})`;
    profils.push({ modele, nom, grille });
  }
  return profils;
}

export function profilSuivi(modele: string, tailles: Record<string, TailleImpression>, profils: Profil[]): Profil | null {
  const entrees = Object.entries(tailles);
  if (entrees.length === 0) return null;
  return profils.find((p) => p.modele === modele && entrees.every(([k, t]) => p.grille[k] === t)) ?? null;
}

// --- Fichiers d'impression ------------------------------------------------------------

/** Ce qui décrit un fichier d'impression sans dépendre d'un produit : le motif, et l'impression qui l'appelle. */
export interface DemandeImpression { motif: string; nom: string; recto: string | null; verso: string | null; taille: string | null }
/** Un fichier d'une ligne de commande, avec les zones où il s'imprime. */
export type FichierDeLigne = DemandeImpression & Pick<FichierImpression, 'faces'>;
export type ImpressionLue = Pick<VarianteImpression, 'recto' | 'verso'> & { taille: string | null };
/** Une ligne de commande (stock ou client) : son identifiant, le titre du produit (qui donne le motif) et son impression. */
export type LigneAImprimer = ImpressionLue & { id: string; titre: string };

/** Une impression (recto, verso, taille) vue comme une variante, pour `fichiersImpression`. */
function commeVariante(i: ImpressionLue): VarianteImpression {
  return { id: '', shopifyId: '', couleur: '', tailleVetement: null, sku: null, recto: i.recto, verso: i.verso, taille: lireTaille(i.taille) };
}

/** Les fichiers que demandent des impressions, chacun une fois, avec l'impression qui sait le refaire. */
export function demandesImpression(motif: string, impressions: ImpressionLue[], reglages: Reglages, fiche: FicheMotif | null): FichierDeLigne[] {
  const demandes = new Map<string, FichierDeLigne>();
  for (const i of impressions) {
    for (const f of fichiersImpression(motif, [commeVariante(i)], reglages, fiche)) {
      if (!demandes.has(f.nom)) demandes.set(f.nom, { motif, nom: f.nom, recto: i.recto, verso: i.verso, taille: i.taille, faces: f.faces });
    }
  }
  return [...demandes.values()].sort((a, b) => (a.nom < b.nom ? -1 : 1));
}

/** Le fichier qu'une demande désigne, ou null s'il n'existe plus (motif ou réglages changés depuis). */
export function fichierDemande(d: DemandeImpression, reglages: Reglages, fiche: FicheMotif | null): FichierImpression | null {
  return fichiersImpression(d.motif, [commeVariante(d)], reglages, fiche).find((f) => f.nom === d.nom) ?? null;
}

/** Les fichiers à imprimer pour un produit, nommés comme l'atelier les lit sur la commande. */
export function fichiersImpression(motif: string, variantes: VarianteImpression[], reglages: Reglages, fiche: FicheMotif | null): FichierImpression[] {
  const fichiers = new Map<string, FichierImpression>();
  for (const v of variantes) {
    for (const face of FACES) {
      const valeur = v[face];
      const impression = lireImpression(valeur, face);
      const teinte = impression && teinteReglee(reglages, impression.teinte);
      if (!impression || !teinte || !valeur) continue;

      let fichier: Omit<FichierImpression, 'faces'> | null = null;
      if (impression.pose === 'dtf') {
        fichier = { nom: `${motif} DTF-${impression.teinte} COEUR.png`, source: 'DTF', teinte: impression.teinte, hauteurCm: null };
      } else if (impression.pose === 'marque') {
        fichier = { nom: `${motif} DTG-${impression.teinte} MARQUE.png`, source: 'MARQUE', teinte: impression.teinte, hauteurCm: null };
      } else {
        const hauteur = v.taille ? fiche?.hauteurs[v.taille] : undefined;
        if (v.taille && hauteur) {
          fichier = { nom: `${motif} ${valeur.trim().toUpperCase()} ${v.taille}.png`, source: teinte.version, teinte: impression.teinte, hauteurCm: hauteur };
        }
      }
      if (!fichier) continue;
      const deja = fichiers.get(fichier.nom);
      if (deja) { if (!deja.faces.includes(face)) deja.faces.push(face); } else fichiers.set(fichier.nom, { ...fichier, faces: [face] });
    }
  }
  return [...fichiers.values()].sort((a, b) => (a.nom < b.nom ? -1 : 1));
}

// --- Résolution PNG --------------------------------------------------------------------

const TABLE_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(octets: Uint8Array): number {
  let c = 0xffffffff;
  for (const o of octets) c = TABLE_CRC[(c ^ o) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Inscrit 300 dpi dans un PNG (bloc pHYs juste après IHDR) : sans lui, le logiciel
 * d'impression lirait 72 dpi et imprimerait le fichier à la mauvaise taille.
 */
export function avec300dpi(png: Uint8Array): Uint8Array {
  const phys = new Uint8Array(21);
  const vue = new DataView(phys.buffer);
  vue.setUint32(0, 9);
  phys.set([0x70, 0x48, 0x59, 0x73], 4); // « pHYs »
  vue.setUint32(8, PX_PAR_METRE_300DPI);
  vue.setUint32(12, PX_PAR_METRE_300DPI);
  phys[16] = 1; // unité : le mètre
  vue.setUint32(17, crc32(phys.subarray(4, 17)));

  const morceaux: Uint8Array[] = [png.subarray(0, 8)];
  const source = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let i = 8; i < png.length;) {
    const longueur = source.getUint32(i);
    const type = String.fromCharCode(...png.subarray(i + 4, i + 8));
    const fin = i + 12 + longueur;
    if (type !== 'pHYs') morceaux.push(png.subarray(i, fin));
    if (type === 'IHDR') morceaux.push(phys);
    i = fin;
  }
  const sortie = new Uint8Array(morceaux.reduce((n, m) => n + m.length, 0));
  let position = 0;
  for (const m of morceaux) { sortie.set(m, position); position += m.length; }
  return sortie;
}

/**
 * Le noir pur d'un PNG à palette : la réduction des couleurs peut arrondir le noir du fond en (1,1,0), que
 * l'imprimante lirait comme de l'encre. Toute couleur de la palette sans composante au-dessus de 4 redevient (0,0,0).
 */
export function noirPur(png: Uint8Array): Uint8Array {
  const sortie = png.slice();
  const vue = new DataView(sortie.buffer);
  for (let i = 8; i < sortie.length;) {
    const longueur = vue.getUint32(i);
    if (String.fromCharCode(...sortie.subarray(i + 4, i + 8)) === 'PLTE') {
      for (let c = i + 8; c < i + 8 + longueur; c += 3) {
        if (Math.max(sortie[c], sortie[c + 1], sortie[c + 2]) <= 4) sortie.fill(0, c, c + 3);
      }
      vue.setUint32(i + 8 + longueur, crc32(sortie.subarray(i + 4, i + 8 + longueur)));
    }
    i += 12 + longueur;
  }
  return sortie;
}
