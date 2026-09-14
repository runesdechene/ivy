/**
 * Fournitures d'un stand : tables, chaises, bannières… et les CAISSES.
 *
 * Tout passe la frontière avec la marchandise mais ne se vend pas : tout revient
 * entier. Poids et valeur sont UNITAIRES ; la valeur est une estimation en euros,
 * une grande partie du matériel étant fabriquée par le déclarant.
 *
 * Une caisse est une fourniture à part : elle CONTIENT la marchandise. Son poids
 * entre dans le poids brut de la marchandise (case 24 du 11.74), jamais dans le
 * tableau du matériel d'exposition — sinon il serait compté deux fois. Le reste
 * du matériel n'entre dans aucun total de la marchandise (pièces, valeur, TVA).
 */

export interface ObjetMateriel {
  designation: string;
  quantite: number;
  /** Poids d'UN objet, en kg. */
  poids_kg: number;
  /** Valeur estimée d'UN objet, en euros. */
  valeur_eur: number;
  /** Sert à transporter la marchandise : son poids va dans le brut. */
  caisse: boolean;
}

/** Une ligne telle que tapée : Mantine renvoie « 1, » en texte pendant la frappe. */
export interface LigneSaisie {
  designation: string;
  quantite: number | string;
  poids_kg: number | string;
  valeur_eur: number | string;
  caisse: boolean;
}

type Resultat = { materiel: ObjetMateriel[] } | { erreur: string };

const positifOuNul = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** Contrôle une liste venue du réseau ou de la base. Une ligne fausse est refusée, jamais corrigée. */
export function validerMateriel(raw: unknown): Resultat {
  if (!Array.isArray(raw)) return { erreur: 'Le matériel doit être une liste' };
  const materiel: ObjetMateriel[] = [];
  for (const [i, item] of raw.entries()) {
    const ligne = `ligne ${i + 1}`;
    if (!item || typeof item !== 'object') return { erreur: `Matériel, ${ligne} : objet invalide` };
    const o = item as Record<string, unknown>;
    const designation = typeof o.designation === 'string' ? o.designation.trim() : '';
    if (!designation) return { erreur: `Matériel, ${ligne} : désignation manquante` };
    if (typeof o.quantite !== 'number' || !Number.isInteger(o.quantite) || o.quantite < 1) {
      return { erreur: `Matériel, ${ligne} : la quantité doit être un entier d'au moins 1` };
    }
    if (!positifOuNul(o.poids_kg)) return { erreur: `Matériel, ${ligne} : poids invalide` };
    if (!positifOuNul(o.valeur_eur)) return { erreur: `Matériel, ${ligne} : valeur invalide` };
    // Absent sur les lignes d'avant les caisses : une fourniture ordinaire.
    const caisse = o.caisse === true;
    materiel.push({ designation, quantite: o.quantite, poids_kg: o.poids_kg, valeur_eur: o.valeur_eur, caisse });
  }
  return { materiel };
}

const nombre = (v: number | string): number =>
  typeof v === 'number' ? v : v.trim() === '' ? Number.NaN : Number(v.replace(',', '.'));

/** Convertit les lignes tapées, ignore les lignes entièrement vides, puis valide. */
export function depuisSaisie(lignes: LigneSaisie[]): Resultat {
  const remplies = lignes.filter(
    (l) => l.designation.trim() || String(l.quantite).trim() || String(l.poids_kg).trim() || String(l.valeur_eur).trim(),
  );
  return validerMateriel(remplies.map((l) => ({
    designation: l.designation,
    quantite: nombre(l.quantite),
    poids_kg: nombre(l.poids_kg),
    // Une caisse n'a souvent pas de valeur à déclarer : vide vaut 0.
    valeur_eur: l.caisse && String(l.valeur_eur).trim() === '' ? 0 : nombre(l.valeur_eur),
    caisse: l.caisse,
  })));
}

export function versSaisie(materiel: ObjetMateriel[]): LigneSaisie[] {
  return materiel.map((o) => ({ ...o }));
}

export function totauxMateriel(materiel: ObjetMateriel[]): { objets: number; poidsKg: number; valeurEur: number } {
  return materiel.reduce(
    (t, o) => ({
      objets: t.objets + o.quantite,
      poidsKg: t.poidsKg + o.quantite * o.poids_kg,
      valeurEur: t.valeurEur + o.quantite * o.valeur_eur,
    }),
    { objets: 0, poidsKg: 0, valeurEur: 0 },
  );
}

export function separerFournitures(fournitures: ObjetMateriel[]): { caisses: ObjetMateriel[]; materiel: ObjetMateriel[] } {
  return {
    caisses: fournitures.filter((o) => o.caisse),
    materiel: fournitures.filter((o) => !o.caisse),
  };
}

/**
 * Les caisses d'un passage : leur poids total et, s'il existe, leur poids par type.
 *
 * Caisses-fournitures (`source: 'caisses'`) : un total et un nombre de caisses,
 * AUCUN poids par type. Une caisse mélange les types ; la feuille dit seulement
 * que tous les articles sont répartis dans X caisses, et seul le brut total
 * (case 24) est donné. Répartir au prorata inventerait une précision fausse.
 *
 * Passage clôturé avant les caisses-fournitures (`source: 'types'`) : ses
 * caisses par type, figées, restent affichées comme à l'époque.
 */
export function caissesParType(
  fournitures: ObjetMateriel[],
  caissesParTypeAnciennes: Record<string, number>,
): { source: 'caisses' | 'types' | 'aucune'; totalKg: number; nombre: number; parType: Record<string, number> } {
  const caisses = totauxMateriel(separerFournitures(fournitures).caisses);
  if (caisses.poidsKg > 0) {
    return { source: 'caisses', totalKg: caisses.poidsKg, nombre: caisses.objets, parType: {} };
  }
  const anciennes = Object.entries(caissesParTypeAnciennes).filter(([, kg]) => Number(kg) > 0);
  if (anciennes.length > 0) {
    return {
      source: 'types',
      totalKg: anciennes.reduce((s, [, kg]) => s + Number(kg), 0),
      nombre: 0,
      parType: Object.fromEntries(anciennes.map(([t, kg]) => [t, Number(kg)])),
    };
  }
  return { source: 'aucune', totalKg: 0, nombre: 0, parType: {} };
}

/** Caisses par type : { type: kg ≥ 0 }. null si la forme est fausse. */
export function validerCaisses(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [type, kg] of Object.entries(raw as Record<string, unknown>)) {
    if (!positifOuNul(kg)) return null;
    out[type] = kg;
  }
  return out;
}
