export interface VariantInput {
  variantId: string;
  soldInWindow: number;
  currentInBox: number;
}

export interface VariantSuggestion extends VariantInput {
  targetQty: number;
  suggestedQty: number;
}

/**
 * Top-up à la capacité au prorata des sorties.
 * Méthode du plus grand reste (Hamilton) — garantit Σ targets == maxCapacity.
 * Si totalSold === 0, fallback équiprobable (max_capacity / N).
 */
export function computeRefillSuggestions(
  variants: VariantInput[],
  maxCapacity: number,
): VariantSuggestion[] {
  if (variants.length === 0 || maxCapacity <= 0) {
    return variants.map((v) => ({ ...v, targetQty: 0, suggestedQty: 0 }));
  }

  const totalSold = variants.reduce((sum, v) => sum + v.soldInWindow, 0);
  const N = variants.length;

  const rawTargets = variants.map((v) =>
    totalSold > 0
      ? (v.soldInWindow / totalSold) * maxCapacity
      : maxCapacity / N,
  );

  const floors = rawTargets.map((t) => Math.floor(t));
  const allocated = floors.reduce((s, n) => s + n, 0);
  const toDistribute = maxCapacity - allocated;

  const remainders = rawTargets
    .map((t, i) => ({ idx: i, rem: t - Math.floor(t) }))
    .sort((a, b) => b.rem - a.rem || a.idx - b.idx);

  const targets = [...floors];
  for (let i = 0; i < toDistribute && i < remainders.length; i++) {
    targets[remainders[i].idx] += 1;
  }

  return variants.map((v, i) => ({
    ...v,
    targetQty: targets[i],
    suggestedQty: Math.max(0, targets[i] - v.currentInBox),
  }));
}
