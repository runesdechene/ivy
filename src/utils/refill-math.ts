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
 * Top-up à la capacité au prorata des sorties (Hamilton method).
 *
 * - Si totalSold === 0 → suggestions = 0 partout (pas de fallback équiprobable :
 *   l'utilisateur ajuste manuellement ou élargit la fenêtre côté UI).
 * - Σ targetQty === maxCapacity quand totalSold > 0.
 * - Σ suggestedQty ≤ max(0, maxCapacity − Σ currentInBox), via scaling Hamilton
 *   sur le budget disponible quand les gaps cumulés excèdent ce budget.
 *   Évite que les variants surstockés "relâchent" du quota qui ferait
 *   dépasser la capacité ailleurs.
 */
export function computeRefillSuggestions(
  variants: VariantInput[],
  maxCapacity: number,
): VariantSuggestion[] {
  if (variants.length === 0 || maxCapacity <= 0) {
    return variants.map((v) => ({ ...v, targetQty: 0, suggestedQty: 0 }));
  }

  const totalSold = variants.reduce((sum, v) => sum + v.soldInWindow, 0);

  if (totalSold === 0) {
    return variants.map((v) => ({ ...v, targetQty: 0, suggestedQty: 0 }));
  }

  const rawTargets = variants.map((v) => (v.soldInWindow / totalSold) * maxCapacity);
  const targets = hamiltonRound(rawTargets, maxCapacity);

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
