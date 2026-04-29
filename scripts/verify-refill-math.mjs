// Sanity check Hamilton math (mirror of src/utils/refill-math.ts in plain JS)

function hamiltonRound(rawTargets, total) {
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

function computeRefillSuggestions(variants, maxCapacity) {
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

  let suggested;
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

let allOk = true;

function expect(label, pred, extra) {
  console.log(`${pred ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!pred) allOk = false;
  return pred;
}

// A — prorata simple (totalSold > 0, gaps fit budget)
{
  const r = computeRefillSuggestions(
    [
      { variantId: 'a', soldInWindow: 50, currentInBox: 5 },
      { variantId: 'b', soldInWindow: 30, currentInBox: 0 },
      { variantId: 'c', soldInWindow: 20, currentInBox: 10 },
    ],
    70,
  );
  const sumT = r.reduce((s, v) => s + v.targetQty, 0);
  const sumS = r.reduce((s, v) => s + v.suggestedQty, 0);
  const sumCurrent = 15;
  const budget = 70 - sumCurrent;
  expect('A - Σ target = 70', sumT === 70);
  expect('A - Σ suggested ≤ budget (55)', sumS <= budget, `got ${sumS}`);
  expect('A - final ≤ capacity', sumCurrent + sumS <= 70, `got ${sumCurrent + sumS}`);
}

// B — totalSold == 0 (PAS de fallback équiprobable, tout 0)
{
  const r = computeRefillSuggestions(
    [
      { variantId: 'a', soldInWindow: 0, currentInBox: 0 },
      { variantId: 'b', soldInWindow: 0, currentInBox: 0 },
      { variantId: 'c', soldInWindow: 0, currentInBox: 0 },
    ],
    70,
  );
  expect(
    'B - tout 0 quand totalSold = 0',
    r.every((v) => v.targetQty === 0 && v.suggestedQty === 0),
  );
}

// C — N=0
{
  const r = computeRefillSuggestions([], 70);
  expect('C - empty input → empty output', r.length === 0);
}

// D — capacity 0
{
  const r = computeRefillSuggestions([{ variantId: 'a', soldInWindow: 5, currentInBox: 0 }], 0);
  expect('D - capacity 0 → all 0', r.every((v) => v.targetQty === 0 && v.suggestedQty === 0));
}

// E — 7 variants dispersés, gaps fit budget
{
  const r = computeRefillSuggestions(
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
  const sumT = r.reduce((s, v) => s + v.targetQty, 0);
  const sumS = r.reduce((s, v) => s + v.suggestedQty, 0);
  const sumCurrent = r.reduce((s, v) => s + v.currentInBox, 0);
  expect('E - Σ target = 100', sumT === 100);
  expect('E - final ≤ capacity', sumCurrent + sumS <= 100, `final = ${sumCurrent + sumS}`);
}

// F — overstocked variant → suggestion 0 sur ce variant
{
  const r = computeRefillSuggestions(
    [
      { variantId: 'a', soldInWindow: 50, currentInBox: 100 },
      { variantId: 'b', soldInWindow: 50, currentInBox: 0 },
    ],
    20,
  );
  expect('F - overstocked variant → suggested 0', r[0].suggestedQty === 0);
  expect('F - other variant gets 0 too (already over capacity)', r[1].suggestedQty === 0);
}

// G — cap-to-budget : variant surstocké relâche du quota mais ne fait pas exploser
// les autres au-delà du budget disponible.
// A overstocked (current 50, target 20), B at 0 (target 50). Sans cap, B aurait
// suggested = 50, mais sum_current = 50 → budget = 20. Suggestions doivent rester ≤ 20.
{
  const r = computeRefillSuggestions(
    [
      { variantId: 'a', soldInWindow: 20, currentInBox: 50 },
      { variantId: 'b', soldInWindow: 50, currentInBox: 0 },
    ],
    70,
  );
  const sumS = r.reduce((s, v) => s + v.suggestedQty, 0);
  const sumCurrent = 50;
  const budget = 20;
  expect('G - Σ suggested ≤ budget (cap au budget disponible)', sumS <= budget, `got ${sumS}/${budget}`);
  expect('G - final ≤ capacity', sumCurrent + sumS <= 70, `final = ${sumCurrent + sumS}`);
  expect('G - A (surstocké) → 0', r[0].suggestedQty === 0);
  expect('G - B reçoit le budget complet', r[1].suggestedQty === 20);
}

// H — caisse déjà au-dessus de la capacité
{
  const r = computeRefillSuggestions(
    [
      { variantId: 'a', soldInWindow: 50, currentInBox: 80 },
      { variantId: 'b', soldInWindow: 50, currentInBox: 0 },
    ],
    70,
  );
  const sumS = r.reduce((s, v) => s + v.suggestedQty, 0);
  expect('H - caisse déjà overflow → toutes suggestions 0', sumS === 0);
}

// I — un seul variant, données réalistes
{
  const r = computeRefillSuggestions([{ variantId: 'a', soldInWindow: 25, currentInBox: 10 }], 40);
  expect('I - single variant target = capacity', r[0].targetQty === 40);
  expect('I - suggested = capacity − current', r[0].suggestedQty === 30);
}

console.log(allOk ? '\nAll checks passed.' : '\nSome checks failed.');
process.exit(allOk ? 0 : 1);
