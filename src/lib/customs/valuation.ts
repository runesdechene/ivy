/**
 * Valeur en douane à l'entrée — règle R1 de la spec « Vente incertaine Suisse ».
 *
 * Référence : OFDF Publ. 52.03, LD art. 9 / 58, LTVA art. 54.
 *
 * La valeur déclarée est le **prix d'achat**, jamais le prix de vente. C'est
 * l'erreur que ce module existe pour empêcher.
 *
 *   NEGOCE            : valeur = prix d'achat HT (EUR) × taux + quote-part transport
 *   PRODUCTION_PROPRE : valeur = valeur marchande (CHF)  + quote-part transport
 *
 * Contrainte C4 : toute valeur persistée doit rester reproductible à partir des
 * lignes sources. La quote-part est donc figée ligne par ligne, et la formule
 * exposée sur le document.
 */

export type MethodeRepartition = 'VALEUR' | 'POIDS';
export type RegimeValeur = 'NEGOCE' | 'PRODUCTION_PROPRE';

/** Taux de TVA suisse admis. 2,6 % = taux réduit (livres, denrées). */
export const TAUX_TVA_CH = [8.1, 2.6] as const;

export interface TariffInfo {
  /** Code SH à 8 chiffres (Tares). */
  position?: string;
  /** Pays d'origine, code ISO. Distinct du pays d'expédition. */
  origine?: string;
  /** Taux de TVA suisse applicable. */
  tva?: number;
}

export interface ValuationLine {
  /** Coût d'achat unitaire hors taxe, en euros (textile + impression). */
  coutUnitaireEur: number;
  quantite: number;
  poidsUnitaireG: number;
}

export interface ValuationResult {
  /** Quote-part de transport attribuée à la ligne entière, en CHF. */
  quotePartChf: number;
  /** Valeur unitaire déclarée, en CHF, transport compris. */
  valeurUnitaireChf: number;
  /** Valeur totale de la ligne, en CHF. */
  valeurLigneChf: number;
}

/**
 * Répartit les frais de transport sur les lignes, puis calcule la valeur d'entrée.
 *
 * La clé de répartition est celle du passage : au prorata de la VALEUR des
 * marchandises, ou au prorata du POIDS. Les deux sont admises ; la spec impose
 * seulement que le choix soit explicite et reproductible.
 */
export function computeValuation(
  lines: ValuationLine[],
  opts: {
    tauxChange: number;
    fraisTransportChf: number;
    methode: MethodeRepartition;
    regime: RegimeValeur;
  },
): ValuationResult[] {
  const { tauxChange, fraisTransportChf, methode, regime } = opts;

  // Base de répartition, avant transport.
  const bases = lines.map(l =>
    methode === 'POIDS'
      ? l.poidsUnitaireG * l.quantite
      : (regime === 'NEGOCE' ? l.coutUnitaireEur * tauxChange : l.coutUnitaireEur) * l.quantite,
  );
  const totalBase = bases.reduce((s, b) => s + b, 0);

  return lines.map((l, i) => {
    // Sans base exploitable, on ne répartit rien plutôt que de diviser par zéro.
    const quotePartChf =
      totalBase > 0 && fraisTransportChf > 0 ? (fraisTransportChf * bases[i]) / totalBase : 0;

    const socleUnitaireChf =
      regime === 'NEGOCE' ? l.coutUnitaireEur * tauxChange : l.coutUnitaireEur;

    const quotePartUnitaire = l.quantite > 0 ? quotePartChf / l.quantite : 0;
    const valeurUnitaireChf = socleUnitaireChf + quotePartUnitaire;

    return {
      quotePartChf,
      valeurUnitaireChf,
      valeurLigneChf: valeurUnitaireChf * l.quantite,
    };
  });
}

/**
 * Base d'imposition et TVA — règle R3.
 *
 * La contre-prestation encaissée est TTC : la base est cet encaissement ramené
 * au hors-taxe. Le calcul se fait **par position tarifaire agrégée**, jamais
 * ligne à ligne : arrondir chaque ligne produit une dérive de plusieurs francs
 * sur un week-end.
 */
export function baseImposition(encaisseTtcChf: number, tauxTva: number): { base: number; tva: number } {
  const base = encaisseTtcChf / (1 + tauxTva / 100);
  return { base: arrondiDeclare(base), tva: arrondiDeclare(base * (tauxTva / 100)) };
}

/** Montant déclaré : arrondi au centime. */
export const arrondiDeclare = (n: number) => Math.round(n * 100) / 100;

/** Espèces encaissées : arrondi aux 5 centimes, usage suisse. */
export const arrondiEspeces = (n: number) => Math.round(n * 20) / 20;

export interface ControleBloquant {
  code: 'A4' | 'A6' | 'A1' | 'A2';
  message: string;
  detail?: string[];
}

/**
 * Contrôles bloquants avant génération de la proforma.
 *
 * A4 : un article sans position tarifaire ou sans origine ne peut pas être
 *      déclaré — la douane classe la marchandise sur ces deux informations.
 * A6 : sans taux de change, aucune valeur n'est calculable.
 * A1/A2 : échéance d'apurement proche ou dépassée.
 */
export function controlesBloquants(args: {
  tauxChange: number | null;
  types: string[];
  tariffByType: Record<string, TariffInfo>;
  dateExpiration: string | null;
  aujourdhui?: string;
}): ControleBloquant[] {
  const out: ControleBloquant[] = [];

  if (!args.tauxChange || args.tauxChange <= 0) {
    out.push({ code: 'A6', message: "Taux de change absent : aucune valeur n'est calculable." });
  }

  const incomplets = args.types.filter(t => {
    const info = args.tariffByType[t];
    return !info?.position || !info?.origine;
  });
  if (incomplets.length > 0) {
    out.push({
      code: 'A4',
      message: `${incomplets.length} type(s) sans position tarifaire ou sans origine.`,
      detail: incomplets,
    });
  }

  if (args.dateExpiration) {
    const today = args.aujourdhui ?? new Date().toISOString().slice(0, 10);
    const jours = Math.round(
      (new Date(args.dateExpiration).getTime() - new Date(today).getTime()) / 86_400_000,
    );
    if (jours < 0) {
      out.push({
        code: 'A2',
        message: `Délai d'apurement dépassé depuis ${Math.abs(jours)} jour(s) : les redevances conditionnelles sont exigibles.`,
      });
    } else if (jours <= 7) {
      out.push({
        code: 'A1',
        message: `Apurement à faire sous ${jours} jour(s).`,
      });
    }
  }

  return out;
}
