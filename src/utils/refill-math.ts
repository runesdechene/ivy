export interface VariantInput {
  variantId: string;
  soldInWindow: number;
  currentInBox: number;
}

export interface VariantSuggestion extends VariantInput {
  targetQty: number;
  suggestedQty: number;
}

function hamiltonRound(rawTargets: number[], total: number): number[] {
  const floors = rawTargets.map((t) => Math.floor(t));
  const allocated = floors.reduce((s, n) => s + n, 0);
  const toDistribute = total - allocated;
  const remainders = rawTargets
    .map((t, i) => ({ idx: i, rem: t - Math.floor(t) }))
    .sort((a, b) => b.rem - a.rem || a.idx - b.idx);
  const result = [...floors];
  for (let i = 0; i < toDistribute && i < remainders.length; i++) {
    result[remainders[i].idx] += 1;
  }
  return result;
}

/**
 * Suggestion = remplacer ce qu'on a vendu sur la fenêtre.
 *
 * - target_v = soldInWindow (ce qu'on a écoulé sur la fenêtre)
 * - suggested_v = max(0, target_v − currentInBox)
 * - Si Σ suggested > budget (max_capacity − Σ current), on scale proportionnellement
 *   via Hamilton pour que la suggestion par défaut tienne dans la caisse.
 *   L'utilisateur peut toujours sur-commander manuellement après coup.
 *
 * Pas de fallback équiprobable, pas de prorata sur la capacité : si une variante
 * n'a rien vendu, on suggère 0. Réaliste et prévisible.
 */
export function computeRefillSuggestions(
  variants: VariantInput[],
  maxCapacity: number,
): VariantSuggestion[] {
  if (variants.length === 0) return [];

  const targets = variants.map((v) => v.soldInWindow);
  const gaps = variants.map((v, i) => Math.max(0, targets[i] - v.currentInBox));
  const totalGap = gaps.reduce((s, n) => s + n, 0);

  const sumCurrent = variants.reduce((s, v) => s + v.currentInBox, 0);
  const budget = Math.max(0, maxCapacity - sumCurrent);

  let suggested: number[];
  if (totalGap === 0 || budget === 0) {
    suggested = variants.map(() => 0);
  } else if (totalGap <= budget) {
    suggested = gaps;
  } else {
    const scaledRaw = gaps.map((g) => (g / totalGap) * budget);
    suggested = hamiltonRound(scaledRaw, budget);
  }

  return variants.map((v, i) => ({
    ...v,
    targetQty: targets[i],
    suggestedQty: suggested[i],
  }));
}
