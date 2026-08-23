/**
 * Pousse les poids d'Ivy vers Shopify.
 *
 * Utilise `productVariantsBulkUpdate` : toutes les variantes d'un produit en un
 * seul appel (~120 appels au lieu de ~5000). Le champ visé est
 * `inventoryItem.measurement.weight`.
 *
 * PRUDENCE INTÉGRÉE : le script commence par UN produit, relit le poids chez
 * Shopify pour vérifier que la mutation a réellement pris, et ne continue que
 * si c'est confirmé. La doc ne documente pas explicitement ce champ dans cette
 * mutation — on vérifie plutôt que de parier.
 *
 * Ne touche à RIEN d'autre : ni stock, ni prix, ni Ivy.
 *
 *   node scripts/push-weights-to-shopify.mjs           (simulation + test 1 produit)
 *   node scripts/push-weights-to-shopify.mjs --apply   (pousse tout)
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
const H = { apikey: K, Authorization: `Bearer ${K}` };
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
const ENDPOINT = `https://${shop.shopify_url}/admin/api/2026-01/graphql.json`;

async function gql(query, variables, attempt = 1) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': shop.shopify_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const data = await r.json().catch(() => null);
  const throttled = data?.errors?.some(e => /throttl/i.test(e?.message ?? ''));
  if ((r.status === 429 || throttled) && attempt <= 6) {
    await sleep(2000 * attempt);
    return gql(query, variables, attempt + 1);
  }
  if (!r.ok || data?.errors) {
    throw new Error(`Shopify HTTP ${r.status} ${JSON.stringify(data?.errors ?? {}).slice(0, 300)}`);
  }
  return data;
}

const MUTATION = `
  mutation bulk($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
      productVariants { id }
    }
  }
`;

const READBACK = `
  query check($id: ID!) {
    productVariant(id: $id) {
      id
      inventoryItem { measurement { weight { unit value } } }
    }
  }
`;

const products = await readAll('products?select=id,shopify_id,title&order=id');
const variants = await readAll('product_variants?select=id,product_id,shopify_id,weight_grams,inventory_item_id,shopify_active&weight_grams=not.is.null&order=id');

const byProduct = new Map();
let skipped = 0;
for (const v of variants) {
  // Variante morte ou jamais sur Shopify : son id est inutilisable côté Shopify.
  if (!v.shopify_id || !v.inventory_item_id || v.shopify_active === false) { skipped++; continue; }
  const p = products.find(x => x.id === v.product_id);
  if (!p || !p.shopify_id) { skipped++; continue; }
  const list = byProduct.get(p.shopify_id) ?? { title: p.title, variants: [] };
  list.variants.push(v);
  byProduct.set(p.shopify_id, list);
}

const totalVariants = [...byProduct.values()].reduce((s, p) => s + p.variants.length, 0);
console.log(`Variantes avec un poids dans Ivy : ${variants.length}`);
console.log(`  poussables vers Shopify        : ${totalVariants}`);
console.log(`  ignorées (morte / locale)      : ${skipped}`);
console.log(`  produits à traiter             : ${byProduct.size}\n`);

const payloadFor = list =>
  list.variants.map(v => ({
    id: `gid://shopify/ProductVariant/${v.shopify_id}`,
    inventoryItem: { measurement: { weight: { unit: 'GRAMS', value: v.weight_grams } } },
  }));

// --- Test sur un seul produit, avec relecture ---
const [firstId, firstList] = [...byProduct.entries()][0];
const witness = firstList.variants[0];
console.log(`Test sur « ${firstList.title} » (${firstList.variants.length} variantes)`);
console.log(`  témoin : variante ${witness.shopify_id}, poids attendu ${witness.weight_grams} g`);

const testRes = await gql(MUTATION, {
  productId: `gid://shopify/Product/${firstId}`,
  variants: payloadFor(firstList),
});
const testErrors = testRes?.data?.productVariantsBulkUpdate?.userErrors ?? [];
if (testErrors.length) {
  console.log(`  ÉCHEC : ${JSON.stringify(testErrors).slice(0, 400)}`);
  console.log('\nLa mutation groupée n\'accepte pas le poids. Rien d\'autre n\'a été poussé.');
  process.exit(1);
}

await sleep(1200);
const back = await gql(READBACK, { id: `gid://shopify/ProductVariant/${witness.shopify_id}` });
const got = back?.data?.productVariant?.inventoryItem?.measurement?.weight;
console.log(`  relu chez Shopify : ${got ? `${got.value} ${got.unit}` : 'rien'}`);

const ok = got && Math.round(Number(got.value)) === witness.weight_grams && got.unit === 'GRAMS';
if (!ok) {
  console.log('\nLe poids relu ne correspond pas. On s\'arrête : rien d\'autre ne sera poussé.');
  process.exit(1);
}
console.log('  ✓ confirmé\n');

if (!APPLY) {
  console.log(`SIMULATION — seul « ${firstList.title} » a été poussé (test de validité).`);
  console.log(`Relancer avec --apply pour les ${byProduct.size - 1} produits restants.`);
  process.exit(0);
}

let done = 1, pushed = firstList.variants.length;
const failures = [];
for (const [pid, list] of byProduct) {
  if (pid === firstId) continue;
  try {
    const res = await gql(MUTATION, {
      productId: `gid://shopify/Product/${pid}`,
      variants: payloadFor(list),
    });
    const ue = res?.data?.productVariantsBulkUpdate?.userErrors ?? [];
    if (ue.length) failures.push({ title: list.title, error: JSON.stringify(ue).slice(0, 200) });
    else pushed += list.variants.length;
  } catch (e) {
    failures.push({ title: list.title, error: String(e.message).slice(0, 200) });
  }
  done++;
  if (done % 20 === 0) console.log(`  ${done}/${byProduct.size} produits — ${pushed} variantes`);
  await sleep(400);
}

console.log(`\n${pushed} variantes poussées sur ${totalVariants}.`);
if (failures.length) {
  console.log(`${failures.length} produit(s) en échec :`);
  for (const f of failures.slice(0, 15)) console.log(`  - ${f.title} : ${f.error}`);
}
