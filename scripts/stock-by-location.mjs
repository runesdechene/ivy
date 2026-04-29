import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SHOP_NAME = 'Runes de Chêne';

const { data: shops } = await supabase
  .from('shops')
  .select('id, name')
  .ilike('name', `%${SHOP_NAME}%`);
const shop = shops[0];

// Use the SAME query as /api/inventory/stats to avoid the 1000-row limit
const { data: products, error } = await supabase
  .from('products')
  .select(`
    id,
    title,
    status,
    variants:product_variants(
      id,
      inventory_levels(
        quantity,
        location_id
      )
    )
  `)
  .eq('shop_id', shop.id)
  .in('status', ['active', 'local', 'draft']);

if (error) {
  console.error(error);
  process.exit(1);
}

console.log(`Produits non archivés : ${products.length}`);

const totals = new Map(); // shopify_location_id -> total qty (clamped to 0)
const totalsRaw = new Map(); // raw, allowing negatives
const allTotal = { clamped: 0, raw: 0 };
let countedVariants = 0;

for (const p of products) {
  for (const v of p.variants || []) {
    countedVariants++;
    const sumRaw = (v.inventory_levels || []).reduce((s, il) => s + (il.quantity || 0), 0);
    const sumClamped = Math.max(0, sumRaw);
    allTotal.raw += sumRaw;
    allTotal.clamped += sumClamped;

    for (const il of v.inventory_levels || []) {
      const k = il.location_id;
      const qRaw = il.quantity || 0;
      const qC = Math.max(0, qRaw);
      totalsRaw.set(k, (totalsRaw.get(k) || 0) + qRaw);
      totals.set(k, (totals.get(k) || 0) + qC);
    }
  }
}

console.log(`Variantes : ${countedVariants}`);
console.log(`\n— TOTAL TOUTES LOCATIONS —`);
console.log(`Avec Math.max(0, qty) (= ce que Ivy affiche sans filtre) : ${allTotal.clamped}`);
console.log(`Brut (somme par variante puis clampe) : déjà au-dessus.`);
console.log(`Brut SANS clamp final : ${allTotal.raw}`);

const { data: locations } = await supabase
  .from('locations')
  .select('shopify_id, name, active')
  .eq('shop_id', shop.id);

const locName = (sid) => locations?.find(l => l.shopify_id === sid)?.name || `(inconnu: ${sid})`;

console.log(`\n— TOTAL PAR LOCATION (par-variante clampé à 0) —`);
const rows = [...totals.entries()]
  .map(([sid, c]) => ({ sid, clamped: c, raw: totalsRaw.get(sid) || 0, name: locName(sid) }))
  .sort((a, b) => b.clamped - a.clamped);
for (const r of rows) {
  console.log(`  ${String(r.clamped).padStart(5)}  (raw ${String(r.raw).padStart(5)})  ${r.name}`);
}
