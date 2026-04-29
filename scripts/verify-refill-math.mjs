// Sanity check Hamilton math (mirror of src/utils/refill-math.ts in plain JS)

function computeRefillSuggestions(variants, maxCapacity) {
  if (variants.length === 0 || maxCapacity <= 0) {
    return variants.map((v) => ({ ...v, targetQty: 0, suggestedQty: 0 }));
  }
  const totalSold = variants.reduce((sum, v) => sum + v.soldInWindow, 0);
  const N = variants.length;
  const rawTargets = variants.map((v) =>
    totalSold > 0 ? (v.soldInWindow / totalSold) * maxCapacity : maxCapacity / N,
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

function check(label, variants, capacity) {
  const r = computeRefillSuggestions(variants, capacity);
  const sumTargets = r.reduce((s, v) => s + v.targetQty, 0);
  const ok = sumTargets === capacity;
  console.log(`${ok ? '✓' : '✗'} ${label}: Σ targetQty = ${sumTargets} (expected ${capacity})`);
  if (!ok) console.log(JSON.stringify(r, null, 2));
  return ok;
}

let allOk = true;

// Cas A — total_sold > 0
allOk &= check(
  'A1 - prorata simple',
  [
    { variantId: 'a', soldInWindow: 50, currentInBox: 5 },
    { variantId: 'b', soldInWindow: 30, currentInBox: 0 },
    { variantId: 'c', soldInWindow: 20, currentInBox: 10 },
  ],
  70,
);

// Cas B — total_sold == 0 (fallback équiprobable)
allOk &= check(
  'B1 - fallback équiprobable',
  [
    { variantId: 'a', soldInWindow: 0, currentInBox: 0 },
    { variantId: 'b', soldInWindow: 0, currentInBox: 0 },
    { variantId: 'c', soldInWindow: 0, currentInBox: 0 },
  ],
  70,
);

// Cas C — N=0
const c = computeRefillSuggestions([], 70);
console.log(`${c.length === 0 ? '✓' : '✗'} C - empty variants → empty result`);
allOk &= c.length === 0;

// Cas D — capacité 0
const d = computeRefillSuggestions([{ variantId: 'a', soldInWindow: 5, currentInBox: 0 }], 0);
console.log(`${d.every((v) => v.targetQty === 0) ? '✓' : '✗'} D - capacity 0 → all targets 0`);

// Cas E — gros nombre, dispersion
allOk &= check(
  'E - 7 variants, sorties variées',
  [
    { variantId: 'a', soldInWindow: 17, currentInBox: 2 },
    { variantId: 'b', soldInWindow: 23, currentInBox: 0 },
    { variantId: 'c', soldInWindow: 11, currentInBox: 5 },
    { variantId: 'd', soldInWindow: 5, currentInBox: 1 },
    { variantId: 'e', soldInWindow: 9, currentInBox: 0 },
    { variantId: 'f', soldInWindow: 31, currentInBox: 8 },
    { variantId: 'g', soldInWindow: 4, currentInBox: 3 },
  ],
  100,
);

// Cas F — caisse déjà pleine sur 1 variant (suggestion = 0 sur ce variant)
const f = computeRefillSuggestions(
  [
    { variantId: 'a', soldInWindow: 50, currentInBox: 100 }, // overstocked
    { variantId: 'b', soldInWindow: 50, currentInBox: 0 },
  ],
  20,
);
console.log(
  `${f[0].suggestedQty === 0 ? '✓' : '✗'} F - overstocked variant → suggested 0 (got ${f[0].suggestedQty})`,
);

console.log(allOk ? '\nAll checks passed.' : '\nSome checks failed.');
process.exit(allOk ? 0 : 1);
