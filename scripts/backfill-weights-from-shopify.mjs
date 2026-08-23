/**
 * Remplit `product_variants.weight_grams` depuis le poids Shopify.
 *
 * PÉRIMÈTRE STRICT — ce script ne fait qu'UNE chose :
 *   UPDATE product_variants SET weight_grams = <grams Shopify>
 *   WHERE weight_grams IS NULL AND <grams Shopify> > 0
 *
 * Il ne touche PAS à `inventory_levels`. Il ne fait AUCUN delete. Il n'appelle
 * PAS la route de synchronisation. Il n'écrase JAMAIS un poids déjà présent
 * (saisi à la main ou déduit par la page Poids).
 *
 *   node scripts/backfill-weights-from-shopify.mjs           (simulation)
 *   node scripts/backfill-weights-from-shopify.mjs --apply   (écrit)
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

const [shop] = await (await fetch(`${U}/rest/v1/shops?select=shopify_url,shopify_token&limit=1`, { headers: H })).json();

console.log('Lecture des poids chez Shopify...');
const grams = new Map();
let url = `https://${shop.shopify_url}/admin/api/2024-01/products.json?limit=250`;
let pages = 0;
while (url) {
  const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': shop.shopify_token } });
  if (r.status === 429) { await sleep(2500); continue; }
  if (!r.ok) throw new Error(`Shopify ${r.status} sur products.json`);
  const b = await r.json();
  for (const p of b.products || []) {
    for (const v of p.variants || []) {
      if ((v.grams ?? 0) > 0) grams.set(String(v.id), v.grams);
    }
  }
  pages++;
  const link = r.headers.get('link') || '';
  const next = link.match(/<([^>]+)>;\s*rel="next"/);
  url = next ? next[1] : null;
  await sleep(500);
}
console.log(`  ${grams.size} variantes Shopify avec un poids > 0 (${pages} page(s))\n`);

const variants = await readAll('product_variants?select=id,shopify_id,weight_grams&order=id');
const candidates = variants.filter(v => v.weight_grams == null && v.shopify_id && grams.has(String(v.shopify_id)));

console.log(`Variantes dans Ivy            : ${variants.length}`);
console.log(`  déjà un poids               : ${variants.filter(v => v.weight_grams != null).length}`);
console.log(`  à remplir                   : ${candidates.length}`);
console.log(`  sans poids et sans équivalent Shopify : ${variants.filter(v => v.weight_grams == null && (!v.shopify_id || !grams.has(String(v.shopify_id)))).length}`);

// Regroupement par valeur de poids : une requête par poids distinct, pas une par variante.
const byWeight = new Map();
for (const v of candidates) {
  const g = grams.get(String(v.shopify_id));
  if (!byWeight.has(g)) byWeight.set(g, []);
  byWeight.get(g).push(v.id);
}
console.log(`  poids distincts             : ${byWeight.size}\n`);

if (!APPLY) {
  const sample = [...byWeight.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  console.log('Les poids les plus fréquents :');
  for (const [g, ids] of sample) console.log(`  ${String(g).padStart(6)} g  ->  ${ids.length} variantes`);
  console.log("\nSIMULATION — rien n'a été écrit. Relancer avec --apply.");
  process.exit(0);
}

let done = 0;
for (const [g, ids] of byWeight) {
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    // Le filtre weight_grams=is.null est une double sécurité : même si l'état
    // a changé depuis la lecture, on n'écrase jamais un poids existant.
    const r = await fetch(
      `${U}/rest/v1/product_variants?id=in.(${batch.join(',')})&weight_grams=is.null`,
      { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ weight_grams: g }) },
    );
    if (!r.ok) {
      // On s'arrête bruyamment plutôt que de continuer en silence.
      throw new Error(`PATCH ${g} g : HTTP ${r.status} — ${(await r.text()).slice(0, 200)}`);
    }
    done += batch.length;
  }
  if (done % 500 < 200) console.log(`  ${done}/${candidates.length}`);
}

console.log(`\n${done} variantes mises à jour.`);
