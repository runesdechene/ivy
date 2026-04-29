// Sanity check replacement-based math (mirror of src/utils/refill-math.ts)

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
  if (variants.length === 0) return [];
  const targets = variants.map((v) => v.soldInWindow);
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
}

// A — replacement simple : suggestion = sold − current
{
  const r = computeRefillSuggestions(
    [
      { variantId: 'a', soldInWindow: 5, currentInBox: 0 },
      { variantId: 'b', soldInWindow: 3, currentInBox: 1 },
      { variantId: 'c', soldInWindow: 0, currentInBox: 0 },
    ],
    70,
  );
  expect('A1 - sold=5 current=0 → suggested=5', r[0].suggestedQty === 5);
  expect('A2 - sold=3 current=1 → suggested=2', r[1].suggestedQty === 2);
  expect('A3 - sold=0 → suggested=0', r[2].suggestedQty === 0);
}

// B — totalSold == 0 → tout 0
{
  const r = computeRefillSuggestions(
    [
      { variantId: 'a', soldInWindow: 0, currentInBox: 0 },
      { variantId: 'b', soldInWindow: 0, currentInBox: 0 },
    ],
    70,
  );
  expect('B - all 0 quand aucune sortie', r.every((v) => v.suggestedQty === 0));
}

// C — empty
expect('C - empty input → empty', computeRefillSuggestions([], 70).length === 0);

// D — variant overstocké relatif à ses ventes, caisse pas encore pleine
{
  const r = computeRefillSuggestions(
    [
      { variantId: 'a', soldInWindow: 5, currentInBox: 20 }, // overstocked relativement
      { variantId: 'b', soldInWindow: 10, currentInBox: 0 },
    ],
    70,
  );
  // sumCurrent = 20, budget = 50
  // gap_a = max(0, 5-20) = 0
  // gap_b = max(0, 10-0) = 10
  // totalGap = 10 ≤ budget → use as-is
  expect('D - overstocké → suggested 0', r[0].suggestedQty === 0);
  expect('D - other variant gets full replacement', r[1].suggestedQty === 10);
}

// E — réaliste : 30j sur 7 variants, ventes raisonnables
{
  const r = computeRefillSuggestions(
    [
      { variantId: 'a', soldInWindow: 5, currentInBox: 2 },
      { variantId: 'b', soldInWindow: 8, currentInBox: 0 },
      { variantId: 'c', soldInWindow: 3, currentInBox: 5 },
      { variantId: 'd', soldInWindow: 1, currentInBox: 1 },
      { variantId: 'e', soldInWindow: 4, currentInBox: 0 },
      { variantId: 'f', soldInWindow: 7, currentInBox: 8 },
      { variantId: 'g', soldInWindow: 0, currentInBox: 3 },
    ],
    100,
  );
  // Each variant gets max(0, sold - current)
  // a: 3, b: 8, c: 0 (current >= sold), d: 0, e: 4, f: 0, g: 0
  expect('E - a: max(0, 5-2)=3', r[0].suggestedQty === 3);
  expect('E - b: max(0, 8-0)=8', r[1].suggestedQty === 8);
  expect('E - c: max(0, 3-5)=0', r[2].suggestedQty === 0);
  expect('E - e: max(0, 4-0)=4', r[4].suggestedQty === 4);
  expect('E - f: max(0, 7-8)=0', r[5].suggestedQty === 0);
  const sumS = r.reduce((s, v) => s + v.suggestedQty, 0);
  expect('E - Σ suggestion = 15 (réaliste, pas inflation)', sumS === 15);
}

// F — caisse déjà overflow → all 0
{
  const r = computeRefillSuggestions(
    [
      { variantId: 'a', soldInWindow: 5, currentInBox: 80 },
      { variantId: 'b', soldInWindow: 5, currentInBox: 0 },
    ],
    70,
  );
  expect('F - over capacity → all 0', r.every((v) => v.suggestedQty === 0));
}

// G — Σ gaps > budget → scale au budget via Hamilton
{
  const r = computeRefillSuggestions(
    [
      { variantId: 'a', soldInWindow: 30, currentInBox: 0 }, // gap 30
      { variantId: 'b', soldInWindow: 20, currentInBox: 0 }, // gap 20
    ],
    40,
  );
  const sumS = r.reduce((s, v) => s + v.suggestedQty, 0);
  expect('G - sum gaps=50 > budget=40 → scale au budget', sumS === 40);
  expect('G - prorata: a~24, b~16', r[0].suggestedQty === 24 && r[1].suggestedQty === 16);
}

// H — budget large, suggestions tiennent → pas de scale
{
  const r = computeRefillSuggestions(
    [
      { variantId: 'a', soldInWindow: 3, currentInBox: 0 },
      { variantId: 'b', soldInWindow: 4, currentInBox: 0 },
    ],
    100,
  );
  expect('H - sum gaps=7 ≤ budget=100 → use gaps as-is', r[0].suggestedQty === 3 && r[1].suggestedQty === 4);
}

console.log(allOk ? '\nAll checks passed.' : '\nSome checks failed.');
process.exit(allOk ? 0 : 1);
