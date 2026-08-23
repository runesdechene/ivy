/**
 * Pousse le stock d'Ivy vers Shopify. Ivy fait foi.
 *
 * Utilise la mutation GraphQL `inventorySetQuantities` (Admin API 2026-01) :
 * valeurs ABSOLUES, pas des deltas. La REST `inventory_levels/set.json` n'est
 * pas utilisée — même famille que l'endpoint déprécié qui nous a déjà coûté cher.
 *
 * Sécurités :
 *  - ne touche QUE les variantes actives sur Shopify (inventory_item_id présent
 *    ET shopify_active !== false) ; les autres n'existent plus côté Shopify ;
 *  - ne supprime jamais rien, ni dans Ivy ni chez Shopify ;
 *  - s'ARRÊTE bruyamment au premier lot en échec, au lieu de continuer en silence.
 *
 *   node scripts/push-stock-to-shopify.mjs           (simulation)
 *   node scripts/push-stock-to-shopify.mjs --apply   (écrit chez Shopify)
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

const [shop] = await (await fetch(`${U}/rest/v1/shops?select=id,shopify_url,shopify_token&limit=1`, { headers: H })).json();
const locations = await readAll(`locations?select=id,name,shopify_id&shop_id=eq.${shop.id}&order=name`);
const locName = new Map(locations.map(l => [String(l.shopify_id), l.name]));

const variants = await readAll('product_variants?select=id,inventory_item_id,shopify_active&order=id');
const V = new Map(variants.map(v => [v.id, v]));

const levels = await readAll('inventory_levels?select=variant_id,location_id,quantity&order=variant_id');

// Ce qu'on est en droit de pousser
const pushable = [];
let skippedInactive = 0, skippedNoItem = 0;
for (const l of levels) {
  const v = V.get(l.variant_id);
  if (!v || !v.inventory_item_id) { skippedNoItem++; continue; }
  if (v.shopify_active === false) { skippedInactive++; continue; }
  pushable.push({
    inventoryItemId: `gid://shopify/InventoryItem/${v.inventory_item_id}`,
    locationId: `gid://shopify/Location/${l.location_id}`,
    quantity: l.quantity ?? 0,
    _loc: String(l.location_id),
    _item: String(v.inventory_item_id),
  });
}

console.log(`Lignes de stock dans Ivy      : ${levels.length}`);
console.log(`  poussables vers Shopify     : ${pushable.length}`);
console.log(`  ignorées (variante morte)   : ${skippedInactive}`);
console.log(`  ignorées (jamais sur Shopify): ${skippedNoItem}\n`);

// État actuel chez Shopify, pour montrer l'écart avant d'écrire
async function shopifyGet(url, attempt = 1) {
  const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': shop.shopify_token } });
  if (r.status === 429) {
    if (attempt > 6) throw new Error('Shopify 429 persistant');
    await sleep(2000 * attempt);
    return shopifyGet(url, attempt + 1);
  }
  if (!r.ok) throw new Error(`Shopify ${r.status}`);
  return r;
}

const current = new Map();
for (const loc of new Set(pushable.map(p => p._loc))) {
  let url = `https://${shop.shopify_url}/admin/api/2024-01/inventory_levels.json?location_ids=${loc}&limit=250`;
  while (url) {
    const r = await shopifyGet(url);
    const b = await r.json();
    for (const lvl of b.inventory_levels || []) {
      current.set(`${lvl.inventory_item_id}@${loc}`, lvl.available ?? 0);
    }
    const link = r.headers.get('link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
    await sleep(600);
  }
}

const diffs = [];
let same = 0;
for (const p of pushable) {
  const before = current.get(`${p._item}@${p._loc}`);
  if (before === p.quantity) { same++; continue; }
  diffs.push({ ...p, before: before ?? null });
}

const byLoc = {};
for (const d of diffs) {
  const k = locName.get(d._loc) || d._loc;
  byLoc[k] ??= { lines: 0, deltaPieces: 0 };
  byLoc[k].lines++;
  byLoc[k].deltaPieces += d.quantity - (d.before ?? 0);
}

console.log(`Identiques chez Shopify : ${same}`);
console.log(`À corriger              : ${diffs.length}\n`);
for (const [k, v] of Object.entries(byLoc)) {
  const sign = v.deltaPieces >= 0 ? '+' : '';
  console.log(`  ${k.padEnd(26)} ${String(v.lines).padStart(4)} lignes   ${sign}${v.deltaPieces} pièces`);
}
console.log('\nExemples :');
for (const d of diffs.slice(0, 8)) {
  console.log(`  item ${d._item}  ${d.before ?? '(absent)'} -> ${d.quantity}`);
}

if (!APPLY) {
  console.log("\nSIMULATION — rien n'a été écrit chez Shopify. Relancer avec --apply.");
  process.exit(0);
}

const MUTATION = `
  mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      userErrors { code field message }
      inventoryAdjustmentGroup { createdAt }
    }
  }
`;

let done = 0;
for (let i = 0; i < diffs.length; i += 100) {
  const batch = diffs.slice(i, i + 100);
  const variables = {
    input: {
      name: 'available',
      reason: 'correction',
      ignoreCompareQuantity: true,
      referenceDocumentUri: `logistics://ivy/recount/${new Date().toISOString().slice(0, 10)}`,
      quantities: batch.map(b => ({
        inventoryItemId: b.inventoryItemId,
        locationId: b.locationId,
        quantity: b.quantity,
      })),
    },
  };

  const r = await fetch(`https://${shop.shopify_url}/admin/api/2026-01/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': shop.shopify_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: MUTATION, variables }),
  });
  const data = await r.json().catch(() => null);

  if (!r.ok || data?.errors) {
    throw new Error(`Lot ${i}: HTTP ${r.status} ${JSON.stringify(data?.errors ?? {}).slice(0, 300)}`);
  }
  const ue = data?.data?.inventorySetQuantities?.userErrors ?? [];
  if (ue.length) {
    throw new Error(`Lot ${i}: userErrors ${JSON.stringify(ue).slice(0, 400)}`);
  }

  done += batch.length;
  console.log(`  poussé ${done}/${diffs.length}`);
  await sleep(1000);
}

console.log('\nShopify est aligné sur Ivy.');
