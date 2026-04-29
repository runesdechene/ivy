import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SHOP_NAME = 'Runes de Chêne';
const LOCATION_QUERY = 'Uriel';

const { data: shops } = await supabase
  .from('shops')
  .select('id, name')
  .ilike('name', `%${SHOP_NAME}%`);
const shop = shops?.[0];
if (!shop) { console.error('Shop not found'); process.exit(1); }
console.log(`Boutique : ${shop.name}`);

const { data: locations } = await supabase
  .from('locations')
  .select('id, shopify_id, name, active')
  .eq('shop_id', shop.id);

const matchingLoc = (locations || []).find(l => l.name?.toLowerCase().includes(LOCATION_QUERY.toLowerCase()));
if (!matchingLoc) { console.error(`No location matching "${LOCATION_QUERY}"`); process.exit(1); }
console.log(`Emplacement : ${matchingLoc.name} (shopify_id=${matchingLoc.shopify_id})\n`);

// Same query pattern as /api/inventory/stats — start from products to bypass the 1000-row limit.
const { data: products, error } = await supabase
  .from('products')
  .select(`
    id, title, product_type, status,
    variants:product_variants(
      id, sku, option1, option2, option3,
      inventory_levels(quantity, location_id)
    )
  `)
  .eq('shop_id', shop.id)
  .in('status', ['active', 'local', 'draft']);

if (error) { console.error(error.message); process.exit(1); }

const variants = [];
for (const p of products) {
  for (const v of p.variants || []) {
    const level = (v.inventory_levels || []).find(il => il.location_id === matchingLoc.shopify_id);
    const rawQty = level?.quantity ?? 0;
    if (rawQty === 0) continue; // skip ruptures from output, but keep for stats below
    variants.push({
      title: p.title || '?',
      type: p.product_type || '',
      sku: v.sku || '',
      o1: v.option1 || '',
      o2: v.option2 || '',
      o3: v.option3 || '',
      qty: rawQty,
    });
  }
}

let totalRaw = 0, totalClamped = 0, ruptures = 0, totalVariants = 0;
for (const p of products) {
  for (const v of p.variants || []) {
    totalVariants++;
    const level = (v.inventory_levels || []).find(il => il.location_id === matchingLoc.shopify_id);
    const q = level?.quantity ?? 0;
    totalRaw += q;
    totalClamped += Math.max(0, q);
    if (q === 0) ruptures++;
  }
}

const negatives = variants.filter(r => r.qty < 0);
const inStock = variants.filter(r => r.qty > 0);
const lowStock = inStock.filter(r => r.qty <= 3);

console.log(`Produits actifs       : ${products.length}`);
console.log(`Variantes actives     : ${totalVariants}`);
console.log(`Stock total (clampé)  : ${totalClamped} unités  ← chiffre Ivy`);
console.log(`Stock total brut      : ${totalRaw} unités`);
console.log(`En stock (qty > 0)    : ${inStock.length} variantes`);
console.log(`Stock faible (1 à 3)  : ${lowStock.length} variantes`);
console.log(`Ruptures (qty = 0)    : ${ruptures} variantes`);
console.log(`Anomalies (qty < 0)   : ${negatives.length} variantes`);

if (negatives.length > 0) {
  console.log('\n— ANOMALIES (stock négatif, 10 premiers) —');
  for (const r of negatives.slice(0, 10)) {
    const opts = [r.o1, r.o2, r.o3].filter(Boolean).join(' / ');
    console.log(`  ${String(r.qty).padStart(3)}  ${r.title}  [${opts}]  (${r.sku})`);
  }
  if (negatives.length > 10) console.log(`  ... et ${negatives.length - 10} autres`);
}

const byProduct = new Map();
for (const r of inStock) {
  const key = `${r.type} | ${r.title}`;
  if (!byProduct.has(key)) byProduct.set(key, []);
  byProduct.get(key).push(r);
}
const productSummary = [...byProduct.entries()]
  .map(([key, vs]) => ({ key, total: vs.reduce((s, v) => s + v.qty, 0), variants: vs.sort((a, b) => b.qty - a.qty) }))
  .sort((a, b) => b.total - a.total);

console.log(`\n— STOCK PAR PRODUIT (${byProduct.size} produits avec stock, ${inStock.length} variantes) —`);
for (const p of productSummary) {
  console.log(`\n[${p.total}]  ${p.key}`);
  for (const v of p.variants) {
    const opts = [v.o1, v.o2, v.o3].filter(Boolean).join(' / ');
    console.log(`    ${String(v.qty).padStart(3)}  ${opts.padEnd(28)}  ${v.sku}`);
  }
}
