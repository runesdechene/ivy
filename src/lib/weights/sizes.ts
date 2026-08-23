// Échelle de tailles utilisée pour déduire les poids des variantes par variation
// cumulée en pourcentage depuis une taille pesée (référence). Aucune dépendance.

export const SIZE_LADDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'] as const;

export type SizeLabel = (typeof SIZE_LADDER)[number];

// Valeur affichée quand une variante n'a pas de taille (produit sans option taille).
export const NO_SIZE = '—';

// Synonymes rencontrés dans les options Shopify -> forme canonique de l'échelle.
const SIZE_SYNONYMS: Record<string, SizeLabel> = {
  '2XL': 'XXL',
  XXXL: '3XL',
};

/**
 * Normalise une valeur brute d'option Shopify en taille canonique de SIZE_LADDER.
 * Renvoie null si la valeur ne correspond à aucune taille connue (hors échelle).
 */
export function normalizeSize(raw: string | null | undefined): SizeLabel | null {
  if (!raw) return null;

  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return null;

  const canonical = SIZE_SYNONYMS[trimmed] ?? trimmed;

  const match = SIZE_LADDER.find((size) => size === canonical);
  return match ?? null;
}

/**
 * Nombre de crans entre une taille de référence et une taille cible sur l'échelle,
 * négatif vers les petites tailles. Renvoie null si l'une des deux tailles est hors
 * échelle (ou non fournie).
 */
export function sizeDistance(
  ref: string | null | undefined,
  target: string | null | undefined
): number | null {
  const refSize = normalizeSize(ref);
  const targetSize = normalizeSize(target);
  if (!refSize || !targetSize) return null;

  const refIndex = SIZE_LADDER.indexOf(refSize);
  const targetIndex = SIZE_LADDER.indexOf(targetSize);
  return targetIndex - refIndex;
}

/**
 * poids(d) = round(reference_grams * (1 + step_pct/100) ^ d)
 * où d est le nombre de crans depuis la taille de référence (négatif vers les petites tailles).
 *
 * Exemple validé : référence M = 250 g, variation 8 % ->
 * XS 214, S 231, M 250, L 270, XL 292, XXL 315, 3XL 340.
 */
export function computeWeight(refGrams: number, stepPct: number, distance: number): number {
  return Math.round(refGrams * Math.pow(1 + stepPct / 100, distance));
}
