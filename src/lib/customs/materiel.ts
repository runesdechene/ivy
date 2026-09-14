/**
 * Matériel d'exposition d'un stand : tables, chaises, bannières…
 *
 * Il passe la frontière avec la marchandise mais ne se vend pas : il revient
 * entier. Il n'entre donc JAMAIS dans les totaux de la marchandise (pièces,
 * valeur, TVA). Poids et valeur sont UNITAIRES ; la valeur est une estimation en
 * euros, une grande partie du matériel étant fabriquée par le déclarant.
 */

export interface ObjetMateriel {
  designation: string;
  quantite: number;
  /** Poids d'UN objet, en kg. */
  poids_kg: number;
  /** Valeur estimée d'UN objet, en euros. */
  valeur_eur: number;
}

/** Une ligne telle que tapée : Mantine renvoie « 1, » en texte pendant la frappe. */
export interface LigneSaisie {
  designation: string;
  quantite: number | string;
  poids_kg: number | string;
  valeur_eur: number | string;
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
    materiel.push({ designation, quantite: o.quantite, poids_kg: o.poids_kg, valeur_eur: o.valeur_eur });
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
    valeur_eur: nombre(l.valeur_eur),
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
