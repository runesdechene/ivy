import type { PaiementSumUp } from './sumup';

/**
 * Reconstitution des ventes d'un festival, pour la déclaration WebDec.
 *
 * On sait ce qui a quitté le stock (parti − revenu) et ce qui a été encaissé
 * (paiements SumUp, espèces), mais pas quel article a été vendu à quel prix.
 * On reconstitue une répartition plausible, qui tombe au centime sur l'encaissé.
 *
 * Règles (validées par Uriel, voir la spec du 2026-09-15) :
 *  - chaque pièce vendue est placée une seule fois, dans un paiement ;
 *  - prix ≤ prix affiché du type, ≥ prix minimal du type, sinon la pièce est offerte ;
 *  - remises par tranches de 5 CHF, réparties en pourcentage dans le panier ;
 *  - chaque panier EST un paiement SumUp : même date, même montant que le fichier d'origine ;
 *  - aucune date de mouvement de stock n'est utilisée (Ivy n'est pas une caisse).
 *
 * Deux regards sur un paiement : le prix vu au stand (CHF ronds), qui sert aux paniers
 * et aux règles ; le montant déclaré (EUR × taux du passage), qui sert à la synthèse.
 * Tous les calculs sont en centimes entiers.
 */

export interface PieceVendue {
  type: string;
  piece: string;
  coutEur: number;
}

export interface PrixType {
  /** Prix affiché au stand, CHF : plafond. */
  affiche: number;
  /** Prix le plus bas plausible, CHF : en dessous, la pièce est offerte. */
  minimal: number;
}

export interface LigneVente {
  type: string;
  piece: string;
  prixStandCentimes: number;
  declareCentimes: number;
  offerte: boolean;
}

export interface PaiementReconstitue {
  source: 'sumup' | 'especes';
  /** Référence SumUp ; null pour les espèces, qui n'existent nulle part ailleurs. */
  ref: string | null;
  date: string | null;
  /** Montant d'origine : euros SumUp, ou CHF vus au stand pour les espèces. */
  montant: number;
  devise: 'EUR' | 'CHF';
  standCentimes: number;
  declareCentimes: number;
  lignes: LigneVente[];
}

export interface EntreesReconstitution {
  pieces: PieceVendue[];
  paiements: PaiementSumUp[];
  especesChf: number;
  especesEur: number;
  /** Taux du passage : 1 EUR = taux CHF. */
  taux: number;
  prix: Record<string, PrixType>;
  /**
   * Pièces offertes par le déclarant, par type : bénévoles, organisateurs, échanges.
   * Elles sortent du stock sans encaissement, donc de la répartition, à 0 CHF. Sans
   * elles, l'algorithme finance chaque pièce sortie et choisit lui-même quoi offrir
   * quand l'argent manque — les pièces les plus chères, rarement les bonnes.
   */
  offertes?: Record<string, number>;
}

export interface Reconstitution {
  genereLe: string;
  tauxSumUp: number;
  entrees: Omit<EntreesReconstitution, 'pieces'>;
  paiements: PaiementReconstitue[];
  avertissements: string[];
}

export class ErreurReconstitution extends Error {}

const PAS = 500;          // remises par tranches de 5 CHF
const MAX_PIECES = 8;     // au-delà, un panier n'a plus rien de plausible
const MAX_PANIER_ESPECES = 3;

const somme = <T,>(lst: T[], f: (x: T) => number) => lst.reduce((s, x) => s + f(x), 0);
const chf = (centimes: number) => (centimes / 100).toFixed(2);
const estRondEnEuros = (eur: number) => Math.round(eur * 100) % 100 === 0;

/**
 * Taux auquel SumUp a converti les prix en CHF : celui qui ramène le plus de paiements
 * sur un MULTIPLE DE 5 francs. Un paiement déjà rond en euros est un client payé en
 * euros (au pair).
 *
 * Le critère du franc entier ne suffit pas : sur Arcana il élisait 0.9776, qui donnait
 * 20 paiements entiers mais un seul multiple de 5, et des prix de stand comme 27 ou
 * 104 CHF. Les prix affichés sont ronds et les remises vont par tranches de 5 : un
 * panier tombe donc sur un multiple de 5. Avec ce critère, Arcana retrouve 0.94 (19
 * multiples de 5 sur 25) et août garde son 0.9378 (45 sur 54).
 */
export function estimerTauxSumUp(paiements: PaiementSumUp[], repli: number): number {
  const convertis = paiements.filter((p) => !estRondEnEuros(p.eur));
  if (convertis.length === 0) return repli;
  let meilleur = repli;
  let meilleurCinq = -1;
  let meilleurEntiers = -1;
  let meilleurEcart = Infinity;
  for (let k = 9000; k <= 10000; k++) {
    const r = k / 10000;
    let cinq = 0, entiers = 0, ecart = 0;
    for (const p of convertis) {
      const x = p.eur * r;
      const d = Math.abs(x - Math.round(x));
      if (d <= 0.05) { entiers++; ecart += d; }
      if (Math.abs(x - Math.round(x / 5) * 5) <= 0.05) cinq++;
    }
    const mieux = cinq > meilleurCinq
      || (cinq === meilleurCinq && (entiers > meilleurEntiers
        || (entiers === meilleurEntiers && ecart < meilleurEcart)));
    if (mieux) { meilleur = r; meilleurCinq = cinq; meilleurEntiers = entiers; meilleurEcart = ecart; }
  }
  return meilleur;
}

interface LignePassage {
  product_title: string;
  product_type: string | null;
  size: string | null;
  color: string | null;
  qty_departed: number;
  qty_returned: number | null;
  unit_cost_textile: number | string | null;
  unit_cost_print: number | string | null;
}

/**
 * Pièces ayant quitté le stock, une entrée par pièce. La quantité d'un type est
 * « parti − revenu » sur le TYPE, comme la synthèse : une pièce revenue en plus sur une
 * ligne (rapportée par une cliente) vient en déduction du type.
 */
export function piecesVenduesDuPassage(items: LignePassage[]): PieceVendue[] {
  const ordonnes = [...items].sort((a, b) =>
    a.product_title.localeCompare(b.product_title) || (a.color ?? '').localeCompare(b.color ?? '') || (a.size ?? '').localeCompare(b.size ?? ''));
  const parType = new Map<string, { net: number; pieces: PieceVendue[] }>();
  for (const it of ordonnes) {
    const type = it.product_type ?? '(sans type)';
    const g = parType.get(type) ?? { net: 0, pieces: [] };
    const revenu = it.qty_returned ?? 0;
    g.net += it.qty_departed - revenu;
    const piece = [it.product_title.split('|')[0].trim(), it.color, it.size].filter(Boolean).join(' ');
    const coutEur = (Number(it.unit_cost_textile) || 0) + (Number(it.unit_cost_print) || 0);
    for (let k = 0; k < Math.max(0, it.qty_departed - revenu); k++) g.pieces.push({ type, piece, coutEur });
    parType.set(type, g);
  }
  return [...parType.values()].flatMap((g) => g.pieces.slice(0, Math.max(0, g.net)));
}

interface Piece extends PieceVendue {
  i: number;
  afficheCentimes: number;
  plancherCentimes: number;
  prix: number;
  declare: number;
  offerte: boolean;
}

/**
 * Prix des pièces d'un panier : du prix affiché vers le montant, par tranches de 5 CHF,
 * la pièce la moins remisée en pourcentage baissant d'abord. Un reste de moins de 5 CHF
 * (montant non rond) va sur une seule pièce. Renvoie vrai si un prix non rond a été créé.
 */
function fixerPrix(pieces: Piece[], montant: number, contexte: string): boolean {
  const vendues = pieces.filter((p) => !p.offerte);
  pieces.forEach((p) => { p.prix = p.offerte ? 0 : p.afficheCentimes; });
  let reste = somme(vendues, (p) => p.afficheCentimes) - montant;
  while (reste >= PAS) {
    const p = vendues.filter((q) => q.prix - PAS >= q.plancherCentimes)
      .sort((a, b) => b.prix / b.afficheCentimes - a.prix / a.afficheCentimes || b.afficheCentimes - a.afficheCentimes || a.i - b.i)[0];
    if (!p) throw new ErreurReconstitution(`${contexte} : remise impossible sans descendre sous les prix minimaux.`);
    p.prix -= PAS; reste -= PAS;
  }
  if (reste > 0) {
    const p = vendues.filter((q) => q.prix - reste >= q.plancherCentimes).sort((a, b) => b.prix - a.prix || a.i - b.i)[0];
    if (!p) throw new ErreurReconstitution(`${contexte} : montant impossible à atteindre avec les prix minimaux.`);
    p.prix -= reste;
    return true;
  }
  return false;
}

/** Répartit un montant déclaré sur des pièces au prorata de leur prix stand, au centime. */
function repartirDeclare(pieces: Piece[], declare: number): void {
  const vendues = pieces.filter((p) => p.prix > 0);
  const base = somme(vendues, (p) => p.prix);
  pieces.forEach((p) => { p.declare = 0; });
  if (base === 0) return;
  const restes = vendues.map((p) => { const exact = (declare * p.prix) / base; p.declare = Math.floor(exact); return { p, r: exact - p.declare }; });
  const manque = declare - somme(vendues, (p) => p.declare);
  restes.sort((a, b) => b.r - a.r || a.p.i - b.p.i).slice(0, manque).forEach(({ p }) => { p.declare++; });
}

/** Arrondit une liste de montants exacts au centime, en conservant l'arrondi du total. */
function arrondirEnConservantLeTotal(exacts: number[]): number[] {
  const total = Math.round(somme(exacts, (x) => x));
  const bas = exacts.map(Math.floor);
  const ordre = exacts.map((x, i) => ({ i, r: x - bas[i] })).sort((a, b) => b.r - a.r || a.i - b.i);
  ordre.slice(0, total - somme(bas, (x) => x)).forEach(({ i }) => { bas[i]++; });
  return bas;
}

export function reconstituer(e: EntreesReconstitution): Reconstitution {
  const types = [...new Set(e.pieces.map((p) => p.type))];
  const sansPrix = types.filter((t) => !(e.prix[t]?.affiche > 0) || !(e.prix[t]?.minimal >= 0));
  if (sansPrix.length) {
    throw new ErreurReconstitution(`Prix affiché ou minimal manquant pour : ${sansPrix.join(', ')}. À renseigner dans Paramètres → Douane.`);
  }
  if (e.pieces.length === 0) throw new ErreurReconstitution("Aucune pièce n'a quitté le stock : rien à reconstituer.");
  const especesStand = Math.round((e.especesChf + e.especesEur) * 100); // euros au pair au stand
  if (e.paiements.length === 0 && especesStand === 0) throw new ErreurReconstitution('Aucun encaissement : ni paiement SumUp, ni espèces.');

  const tauxSumUp = estimerTauxSumUp(e.paiements, e.taux);
  const pieces: Piece[] = e.pieces.map((p, i) => {
    const afficheCentimes = Math.round(e.prix[p.type].affiche * 100);
    return {
      ...p, i, afficheCentimes,
      // Jamais sous le prix minimal, ni sous le coût d'achat.
      plancherCentimes: Math.min(afficheCentimes, Math.max(Math.round(e.prix[p.type].minimal * 100), Math.ceil(p.coutEur * e.taux) * 100)),
      prix: 0, declare: 0, offerte: false,
    };
  });

  // Pièces offertes déclarées : mises de côté avant toute répartition.
  const cadeaux: Piece[] = [];
  for (const [type, n] of Object.entries(e.offertes ?? {})) {
    if (!n) continue;
    const dispo = pieces.filter((p) => p.type === type && !p.offerte);
    if (!types.includes(type)) {
      throw new ErreurReconstitution(`${type} : aucune pièce de ce type n'a quitté le stock, elle ne peut pas être offerte.`);
    }
    if (n > dispo.length) {
      throw new ErreurReconstitution(`${n} ${type} offert(e)s, alors que ${dispo.length} pièce(s) de ce type sont sorties du stock.`);
    }
    for (let k = 0; k < n; k++) { dispo[k].offerte = true; cadeaux.push(dispo[k]); }
  }
  const payantes = pieces.filter((p) => !p.offerte);
  if (payantes.length === 0) throw new ErreurReconstitution('Toutes les pièces sorties sont déclarées offertes : rien à répartir.');

  interface Panier { pay: PaiementReconstitue; pieces: Piece[]; exact: number }
  const paniers: Panier[] = e.paiements.map((p) => ({
    pay: {
      source: 'sumup', ref: p.ref, date: p.date, montant: p.eur, devise: 'EUR',
      standCentimes: estRondEnEuros(p.eur) ? Math.round(p.eur) * 100 : Math.round(p.eur * tauxSumUp) * 100,
      declareCentimes: 0, lignes: [],
    },
    pieces: [],
    exact: p.eur * e.taux * 100,
  }));

  const catalogue = somme(payantes, (p) => p.afficheCentimes);
  const encaisseStand = somme(paniers, (p) => p.pay.standCentimes) + especesStand;
  if (encaisseStand > catalogue) {
    throw new ErreurReconstitution(
      `Montant encaissé (${chf(encaisseStand)} CHF au stand) supérieur à la valeur affichée des pièces à vendre (${chf(catalogue)} CHF) : ` +
      'prix affichés trop bas, ou pièces vendues manquantes.');
  }

  // ---------- 1. Panier de base de chaque paiement SumUp ----------
  const libres = new Set(payantes.map((p) => p.i));
  const prendre = (type: string) => {
    const p = pieces.find((q) => libres.has(q.i) && q.type === type)!;
    libres.delete(p.i);
    return p;
  };
  const plancherType = (t: string) => pieces.find((p) => p.type === t)!.plancherCentimes;
  const afficheType = (t: string) => pieces.find((p) => p.type === t)!.afficheCentimes;
  for (const panier of [...paniers].sort((a, b) => b.pay.standCentimes - a.pay.standCentimes || paniers.indexOf(a) - paniers.indexOf(b))) {
    const montant = panier.pay.standCentimes;
    const stock = Object.fromEntries(types.map((t) => [t, pieces.filter((p) => libres.has(p.i) && p.type === t).length]));
    let best: { depassement: number; n: number; choix: Record<string, number> } | null = null;
    const choix: Record<string, number> = {};
    const explorer = (k: number, affiche: number, plancher: number, n: number) => {
      if (n > 0 && plancher <= montant && affiche >= montant) {
        const depassement = affiche - montant;
        if (!best || depassement < best.depassement || (depassement === best.depassement && n < best.n)) best = { depassement, n, choix: { ...choix } };
      }
      if (k === types.length || n === MAX_PIECES || plancher > montant) return;
      const t = types[k];
      for (let q = 0; q <= Math.min(stock[t], MAX_PIECES - n); q++) {
        if (q) choix[t] = q; else delete choix[t];
        explorer(k + 1, affiche + q * afficheType(t), plancher + q * plancherType(t), n + q);
      }
      delete choix[t];
    };
    explorer(0, 0, 0, 0);
    const retenu = best as { choix: Record<string, number> } | null;
    if (!retenu) {
      throw new ErreurReconstitution(
        `Paiement du ${panier.pay.date} (${panier.pay.montant.toFixed(2)} €) : aucun panier possible avec les pièces restantes et les prix du référentiel.`);
    }
    for (const [t, q] of Object.entries(retenu.choix)) for (let k = 0; k < q; k++) panier.pieces.push(prendre(t));
  }

  // ---------- 2. Pièces restantes ----------
  const avertissements: string[] = [];
  const affiche = (lst: Piece[]) => somme(lst, (p) => p.afficheCentimes);
  const planchers = (lst: Piece[]) => somme(lst.filter((p) => !p.offerte), (p) => p.plancherCentimes);
  /** Le lot où ajouter la pièce crée la plus faible remise ; un achat d'une seule pièce reste intact. */
  const lotPour = (p: Piece) => paniers
    .filter((pn) => pn.pieces.length >= 2 && pn.pieces.length < MAX_PIECES && planchers(pn.pieces) + p.plancherCentimes <= pn.pay.standCentimes)
    .sort((a, b) => {
      const ra = (affiche(a.pieces) + p.afficheCentimes - a.pay.standCentimes) / (affiche(a.pieces) + p.afficheCentimes);
      const rb = (affiche(b.pieces) + p.afficheCentimes - b.pay.standCentimes) / (affiche(b.pieces) + p.afficheCentimes);
      return ra - rb || paniers.indexOf(a) - paniers.indexOf(b);
    })[0];

  let reste = [...libres].map((i) => pieces[i]).sort((a, b) => b.afficheCentimes - a.afficheCentimes || a.i - b.i);
  const paniersEspeces: Panier[] = [];
  if (especesStand > 0) {
    // Les planchers des pièces restantes ne doivent pas dépasser les espèces : les plus
    // chères passent d'abord dans les lots SumUp, à défaut elles sont offertes.
    while (planchers(reste) > especesStand) {
      const p = reste.find((q) => !q.offerte)!;
      const lot = lotPour(p);
      if (lot) { lot.pieces.push(p); reste = reste.filter((q) => q !== p); } else { p.offerte = true; }
    }
    if (affiche(reste.filter((p) => !p.offerte)) < especesStand) {
      throw new ErreurReconstitution(
        `Espèces (${chf(especesStand)} CHF au stand) supérieures à la valeur affichée des pièces qu'aucun paiement SumUp ne couvre (${chf(affiche(reste.filter((p) => !p.offerte)))} CHF).`);
    }
    fixerPrix(reste, especesStand, 'Espèces');
    const exactEspeces = e.especesChf * 100 + e.especesEur * e.taux * 100;
    for (let k = 0; k < reste.length; k += MAX_PANIER_ESPECES) {
      const lot = reste.slice(k, k + MAX_PANIER_ESPECES);
      paniersEspeces.push({
        pay: {
          source: 'especes', ref: null, date: null, montant: somme(lot, (p) => p.prix) / 100, devise: 'CHF',
          standCentimes: somme(lot, (p) => p.prix), declareCentimes: 0, lignes: [],
        },
        pieces: lot,
        exact: 0,
      });
    }
    // Montant déclaré des espèces : au prorata du prix stand de chaque panier.
    const exacts = paniersEspeces.map((pn) => (exactEspeces * pn.pay.standCentimes) / especesStand);
    paniersEspeces.forEach((pn, k) => { pn.exact = exacts[k]; });
    if (e.especesEur > 0) avertissements.push(`Espèces en euros lues au pair au stand (1 CHF = 1 €), déclarées au taux du passage (${e.taux}).`);
  } else {
    for (const p of reste) {
      const lot = lotPour(p);
      if (lot) { lot.pieces.push(p); continue; }
      p.offerte = true;
      [...paniers].sort((a, b) => b.pay.standCentimes - a.pay.standCentimes)[0].pieces.push(p);
    }
  }

  // ---------- 3. Prix dans chaque panier SumUp ----------
  let nonRonds = 0;
  for (const pn of paniers) {
    if (fixerPrix(pn.pieces, pn.pay.standCentimes, `Paiement du ${pn.pay.date}`)) nonRonds++;
  }

  // ---------- 4. Montants déclarés ----------
  // Un paiement SumUp s'arrondit SEUL : 106.38 € au taux du passage vaut 100.00 CHF,
  // partout et à chaque fois. Répartir l'arrondi du total sur l'ensemble donnait
  // 100.00 à un paiement et 99.99 à son jumeau — deux fois le même montant, deux
  // résultats : un douanier qui refait la multiplication ne s'y retrouve pas.
  // Le total déclaré est donc la somme des paiements, chacun vérifiable.
  // Les espèces gardent leur répartition interne : leur total, lui, est donné.
  const declaresEspeces = arrondirEnConservantLeTotal(paniersEspeces.map((pn) => pn.exact));
  const tous = [...paniers, ...paniersEspeces];
  // Les cadeaux déclarés voyagent dans le plus gros panier : ils figurent sur la liste
  // des ventes, à 0 CHF, sans rien changer aux montants.
  if (cadeaux.length) {
    [...tous].sort((a, b) => b.pay.standCentimes - a.pay.standCentimes)[0].pieces.push(...cadeaux);
  }
  const declares = [...paniers.map((pn) => Math.round(pn.exact)), ...declaresEspeces];
  tous.forEach((pn, k) => {
    pn.pay.declareCentimes = declares[k];
    repartirDeclare(pn.pieces, declares[k]);
    pn.pay.lignes = pn.pieces.map((p) => ({
      type: p.type, piece: p.piece, prixStandCentimes: p.prix, declareCentimes: p.declare, offerte: p.offerte,
    }));
  });

  if (cadeaux.length) {
    const parType = new Map<string, number>();
    for (const p of cadeaux) parType.set(p.type, (parType.get(p.type) ?? 0) + 1);
    avertissements.push(`${cadeaux.length} pièce(s) déclarée(s) offertes : ${[...parType].map(([t, n]) => `${n} ${t}`).join(', ')}.`);
  }
  const offertes = pieces.filter((p) => p.offerte).length - cadeaux.length;
  if (offertes) avertissements.push(`${offertes} pièce(s) offerte(s) faute d'encaissement : aucun panier ne pouvait les absorber au-dessus de leur prix minimal.`);
  if (nonRonds) avertissements.push(`${nonRonds} paiement(s) SumUp au montant non multiple de 5 CHF : un prix non rond chacun.`);
  avertissements.push(`Taux SumUp retrouvé dans le rapport : 1 € = ${tauxSumUp} CHF.`);

  return {
    genereLe: new Date().toISOString(),
    tauxSumUp,
    entrees: { paiements: e.paiements, especesChf: e.especesChf, especesEur: e.especesEur, taux: e.taux, prix: e.prix },
    paiements: tous.map((pn) => pn.pay),
    avertissements,
  };
}

export interface LigneSynthese {
  type: string;
  sorties: number;
  offertes: number;
  caCentimes: number;
  tvaCentimes: number;
}

/**
 * Synthèse par type : chaque CA est la somme des ventes du type. La TVA suisse s'ajoute
 * PAR-DESSUS le CA (règle de la contre-prestation) : calculée sur le total, arrondie aux
 * 5 centimes pour le paiement, et répartie par type sans perdre un centime.
 */
export function syntheseParType(r: Reconstitution, tauxTva: number): {
  lignes: LigneSynthese[]; caCentimes: number; tvaCentimes: number; tvaAPayerCentimes: number;
} {
  const lignes = r.paiements.flatMap((p) => p.lignes);
  const parType = new Map<string, LigneSynthese>();
  for (const l of lignes) {
    const s = parType.get(l.type) ?? { type: l.type, sorties: 0, offertes: 0, caCentimes: 0, tvaCentimes: 0 };
    s.sorties++;
    if (l.offerte) s.offertes++;
    s.caCentimes += l.declareCentimes;
    parType.set(l.type, s);
  }
  const res = [...parType.values()].sort((a, b) => b.sorties - a.sorties || a.type.localeCompare(b.type));
  const caCentimes = somme(res, (l) => l.caCentimes);
  const tva = arrondirEnConservantLeTotal(res.map((l) => (l.caCentimes * tauxTva) / 100));
  res.forEach((l, k) => { l.tvaCentimes = tva[k]; });
  const tvaCentimes = somme(res, (l) => l.tvaCentimes);
  return { lignes: res, caCentimes, tvaCentimes, tvaAPayerCentimes: Math.round(tvaCentimes / 5) * 5 };
}
