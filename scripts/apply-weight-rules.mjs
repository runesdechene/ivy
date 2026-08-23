/**
 * Applique les règles de poids par type de produit, dans Ivy.
 *
 * Poids déduit d'une pesée de référence, variation CUMULÉE par cran de taille :
 *   poids(d) = round(reference * (1 + step/100) ^ d)
 *
 * PÉRIMÈTRE STRICT : n'écrit que `weight_type_rules` et
 * `product_variants.weight_grams`. Aucun DELETE. Ne touche pas à
 * `inventory_levels`. N'appelle aucune route de synchronisation.
 *
 * Ne pousse PAS vers Shopify : la déclaration douanière lit Ivy en priorité,
 * et pousser ~5000 poids un par un prendrait plus d'une demi-heure. La page
 * Paramètres > Poids sait le faire quand on en aura le temps.
 *
 *   node scripts/apply-weight-rules.mjs           (simulation)
 *   node scripts/apply-weight-rules.mjs --apply   (écrit)
 */
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const repoRoot = path.resolve(import.meta.dirname, '..');
const env = {};
for (const line of fs.readFileSync(path.join(repoRoot, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const U = env.NEXT_PUBLIC_SUPABASE_URL;
const K = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

/** Pesées communiquées par Uriel le 2026-08-23, toutes en taille M. */
const RULES = [
  { type: 'Le Confort', grams: 180 },
  { type: 'Le Moelleux', grams: 650 },
  { type: "L'Ancestral", grams: 240 },
  { type: 'Le Zippé', grams: 750 },
  { type: 'Débardeur Femme', grams: 140 },
  { type: 'Débardeur Homme', grams: 140 },
];
const REF_SIZE = 'M';
const STEP_PCT = 8;

const LADDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
const SYNONYMS = { '2XL': 'XXL', XXXL: '3XL', XXXXL: '4XL', XXXXXL: '5XL' };

function normalizeSize(raw) {
  if (!raw) return null;
  const up = String(raw).trim().toUpperCase();
  const mapped = SYNONYMS[up] ?? up;
  return LADDER.includes(mapped) ? mapped : null;
}
const distance = (ref, target) => LADDER.indexOf(target) - LADDER.indexOf(ref);
const computeWeight = (ref, step, d) => Math.round(ref * Math.pow(1 + step / 100, d));

async function readAll(query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${query}`, { headers: { ...H, Range: `${from}-${from + 999}` } });
    if (!r.ok) throw new Error(`Supabase ${r.status} sur ${query}`);
    const chunk = await r.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    out.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return out;
}

const [shop] = await (await fetch(`${U}/rest/v1/shops?select=id&limit=1`, { headers: H })).json();
const products = await readAll(`products?select=id,product_type,option1_name,option2_name,option3_name&shop_id=eq.${shop.id}&order=id`);
const variants = await readAll('product_variants?select=id,product_id,option1,option2,option3,weight_grams&order=id');
const P = new Map(products.map(p => [p.id, p]));

const byWeight = new Map();
const perType = new Map();
let unresolved = 0;

for (const v of variants) {
  const p = P.get(v.product_id);
  if (!p) continue;
  const rule = RULES.find(r => r.type === p.product_type);
  if (!rule) continue;

  // La taille se lit sur la VALEUR de l'option, jamais sur son nom.
  const size = [v.option1, v.option2, v.option3].map(normalizeSize).find(s => s !== null) ?? null;
  if (!size) { unresolved++; continue; }

  const grams = computeWeight(rule.grams, STEP_PCT, distance(REF_SIZE, size));
  if (!byWeight.has(grams)) byWeight.set(grams, []);
  byWeight.get(grams).push(v.id);

  const t = perType.get(rule.type) ?? { n: 0, sizes: new Map() };
  t.n++;
  t.sizes.set(size, grams);
  perType.set(rule.type, t);
}

console.log(`Référence : taille ${REF_SIZE}, variation ${STEP_PCT} % par cran\n`);
for (const [type, t] of perType) {
  const line = LADDER.filter(s => t.sizes.has(s)).map(s => `${s} ${t.sizes.get(s)}`).join('  ');
  console.log(`${type.padEnd(18)} ${String(t.n).padStart(5)} variantes   ${line}`);
}
console.log(`\nTailles non reconnues (ignorées) : ${unresolved}`);
console.log(`Poids distincts à écrire         : ${byWeight.size}`);
console.log(`Variantes concernées             : ${[...byWeight.values()].reduce((s, a) => s + a.length, 0)}`);

if (!APPLY) {
  console.log("\nSIMULATION — rien n'a été écrit. Relancer avec --apply.");
  process.exit(0);
}

// 1. Les règles, pour que la page Paramètres > Poids reflète la réalité
for (const r of RULES) {
  const res = await fetch(`${U}/rest/v1/weight_type_rules?on_conflict=shop_id,product_type`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      shop_id: shop.id,
      product_type: r.type,
      reference_size: REF_SIZE,
      reference_grams: r.grams,
      step_pct: STEP_PCT,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`règle ${r.type} : HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
}
console.log(`\n${RULES.length} règles enregistrées.`);

// 2. Les poids, groupés par valeur : une requête par poids distinct
let done = 0;
for (const [grams, ids] of byWeight) {
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const res = await fetch(`${U}/rest/v1/product_variants?id=in.(${batch.join(',')})`, {
      method: 'PATCH',
      headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ weight_grams: grams }),
    });
    if (!res.ok) throw new Error(`PATCH ${grams} g : HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
    done += batch.length;
  }
}
console.log(`${done} variantes mises à jour.`);
