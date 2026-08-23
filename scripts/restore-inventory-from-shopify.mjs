/**
 * Restauration de `inventory_levels` depuis Shopify.
 *
 * Sécurité : ce script NE SUPPRIME RIEN. Il lit Shopify emplacement par emplacement
 * et fait un upsert. Si Shopify ne répond pas pour un lot, il s'ARRÊTE au lieu de
 * continuer en silence — c'est précisément le défaut qui a causé la perte.
 *
 * Usage :
 *   node scripts/restore-inventory-from-shopify.mjs           (simulation, n'écrit rien)
 *   node scripts/restore-inventory-from-shopify.mjs --apply   (écrit)
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

async function readAll(query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${query}`, {
      headers: { ...H, Range: `${from}-${from + 999}` },
    });
    if (!r.ok) throw new Error(`Supabase ${r.status} sur ${query}`);
    const chunk = await r.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    out.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Shopify limite à ~2 req/s en REST. On respire entre les pages, et on réessaie sur 429. */
async function shopifyGet(url, token, attempt = 1) {
  const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
  if (r.status === 429) {
    if (attempt > 6) throw new Error('Shopify 429 persistant après 6 tentatives');
    const wait = Number(r.headers.get('retry-after') || 2) * 1000 * attempt;
    console.log(`    429 — pause ${wait} ms puis nouvelle tentative (${attempt})`);
    await sleep(wait);
    return shopifyGet(url, token, attempt + 1);
  }
  if (!r.ok) throw new Error(`Shopify ${r.status} sur ${url.slice(0, 90)}`);
  return r;
}

const [shop] = await (await fetch(`${U}/rest/v1/shops?select=id,shopify_url,shopify_token&limit=1`, { headers: H })).json();
const locations = await readAll(`locations?select=id,name,shopify_id&shop_id=eq.${shop.id}&order=name`);
const variants = await readAll('product_variants?select=id,inventory_item_id,shopify_active&inventory_item_id=not.is.null&order=id');

const byItem = new Map();
for (const v of variants) byItem.set(String(v.inventory_item_id), v);
console.log(`${variants.length} variantes avec un inventory_item_id connu.\n`);

const rows = [];
let unmatched = 0;
const unmatchedSamples = [];

for (const loc of locations) {
  let url = `https://${shop.shopify_url}/admin/api/2024-01/inventory_levels.json?location_ids=${loc.shopify_id}&limit=250`;
  let pieces = 0, lines = 0, pages = 0;

  while (url) {
    const r = await shopifyGet(url, shop.shopify_token);
    const body = await r.json();

    for (const lvl of body.inventory_levels || []) {
      const v = byItem.get(String(lvl.inventory_item_id));
      if (!v) {
        unmatched++;
        if (unmatchedSamples.length < 5) unmatchedSamples.push(lvl.inventory_item_id);
        continue;
      }
      const qty = lvl.available ?? 0;
      rows.push({
        variant_id: v.id,
        location_id: String(loc.shopify_id),
        quantity: qty,
        updated_at: new Date().toISOString(),
      });
      if (qty > 0) { pieces += qty; lines++; }
    }

    pages++;
    const link = r.headers.get('link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
    await sleep(600);
  }

  console.log(`${loc.name.padEnd(26)} ${String(lines).padStart(5)} lignes >0   ${String(pieces).padStart(6)} pieces   (${pages} page(s))`);
}

console.log(`\nTotal a ecrire : ${rows.length} lignes.`);
if (unmatched) {
  console.log(`ATTENTION : ${unmatched} niveaux Shopify sans variante correspondante dans Ivy.`);
  console.log(`  exemples d'inventory_item_id : ${unmatchedSamples.join(', ')}`);
}

if (!APPLY) {
  console.log('\nSIMULATION — rien n\'a ete ecrit. Relancer avec --apply pour restaurer.');
  process.exit(0);
}

let written = 0;
for (let i = 0; i < rows.length; i += 500) {
  const batch = rows.slice(i, i + 500);
  const r = await fetch(`${U}/rest/v1/inventory_levels?on_conflict=variant_id,location_id`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(batch),
  });
  if (!r.ok) {
    // On s'arrête bruyamment : c'est le defaut qui a cause la perte initiale.
    throw new Error(`Ecriture Supabase ${r.status} : ${(await r.text()).slice(0, 300)}`);
  }
  written += batch.length;
  console.log(`  ecrit ${written}/${rows.length}`);
}

console.log('\nRestauration terminee.');
