// One-shot script to complete the inventory sync that was killed by Netlify timeout.
// Reproduces the "verification + dedupe" steps from sync-stream/route.ts (phaseProducts tail)
// using a SINGLE bulk update instead of the 88 sequential updates that timed out.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SHOP_NAME = 'Runes de Chêne';

const t0 = Date.now();
const log = (msg) => console.log(`[+${(Date.now() - t0) / 1000}s] ${msg}`);

const { data: shops } = await supabase
  .from('shops').select('*').ilike('name', `%${SHOP_NAME}%`);
const shop = shops?.[0];
if (!shop) { console.error('Shop not found'); process.exit(1); }
log(`Boutique : ${shop.name}`);

// 1. Re-fetch all products from Shopify (same logic as phaseProducts)
log('📦 Récupération des produits Shopify...');
const all = [];
let url = `https://${shop.shopify_url}/admin/api/2024-01/products.json?limit=250`;
let pageNum = 1;
while (url) {
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': shop.shopify_token, 'Content-Type': 'application/json' },
  });
  if (!res.ok) { console.error(`Shopify error page ${pageNum}: ${res.status}`); process.exit(1); }
  const data = await res.json();
  all.push(...(data.products || []));
  log(`  └─ Page ${pageNum}: ${data.products.length} produits (total ${all.length})`);
  pageNum++;
  const link = res.headers.get('Link');
  const m = link?.match(/<([^>]+)>;\s*rel="next"/);
  url = m?.[1] || null;
}

// 2. Same filter as the route
const filtered = all.filter(p =>
  p.status !== 'draft' && p.status !== 'archived' &&
  !(p.tags && p.tags.split(',').map(t => t.trim().toLowerCase()).includes('no-ivy'))
);
log(`✓ ${filtered.length} produits actifs (après filtres)`);

// 3. Build product UUID map (Supabase products.id <-> products.shopify_id)
const { data: dbProducts } = await supabase
  .from('products').select('id, shopify_id').eq('shop_id', shop.id);
const productIdMap = Object.fromEntries((dbProducts || []).map(p => [p.shopify_id, p.id]));

// 4. Build "keep" set : (product_uuid -> Set<shopify_variant_id>)
const keepByProduct = new Map();
for (const p of filtered) {
  const uuid = productIdMap[p.id.toString()];
  if (!uuid) continue;
  keepByProduct.set(uuid, new Set((p.variants || []).map(v => v.id.toString())));
}
const productUuids = [...keepByProduct.keys()];
log(`✓ ${productUuids.length} produits mappés`);

// 5. Load all currently-active variants for these products (paginated to bypass 1000-row limit)
log('🔍 Chargement des variantes actives en base...');
const variants = [];
for (let i = 0; i < productUuids.length; i += 50) {
  const batch = productUuids.slice(i, i + 50);
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from('product_variants')
      .select('id, product_id, shopify_id')
      .in('product_id', batch)
      .eq('shopify_active', true)
      .range(from, from + 999);
    if (data && data.length > 0) {
      variants.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    } else break;
  }
}
log(`✓ ${variants.length} variantes actives chargées`);

// 6. Compute variants to deactivate (in JS)
const toDeactivate = variants
  .filter(v => {
    const keep = keepByProduct.get(v.product_id);
    return !keep || !keep.has(v.shopify_id);
  })
  .map(v => v.id);

log(`📌 ${toDeactivate.length} variantes à désactiver (absentes de Shopify)`);

// 7. Single bulk update (chunked to avoid PostgREST URL length limits)
if (toDeactivate.length > 0) {
  for (let i = 0; i < toDeactivate.length; i += 500) {
    const batch = toDeactivate.slice(i, i + 500);
    const { error } = await supabase
      .from('product_variants')
      .update({ shopify_active: false })
      .in('id', batch);
    if (error) { console.error(`Update error: ${error.message}`); process.exit(1); }
    log(`  └─ Batch ${Math.floor(i / 500) + 1}/${Math.ceil(toDeactivate.length / 500)} (${batch.length} variantes)`);
  }
  log(`✓ ${toDeactivate.length} variantes marquées comme locales`);
}

// 8. Deduplicate local variants (same logic as deduplicateLocalVariants)
log('🧹 Dédoublonnage des variantes locales...');
const variantsForDedup = [];
for (let i = 0; i < productUuids.length; i += 50) {
  const batch = productUuids.slice(i, i + 50);
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from('product_variants')
      .select('id, product_id, option1, option2, option3, shopify_active')
      .in('product_id', batch)
      .range(from, from + 999);
    if (data && data.length > 0) {
      variantsForDedup.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    } else break;
  }
}

const byProduct = {};
for (const v of variantsForDedup) {
  if (!byProduct[v.product_id]) byProduct[v.product_id] = [];
  byProduct[v.product_id].push(v);
}

const toDelete = [];
for (const productVariants of Object.values(byProduct)) {
  const activeFingerprints = new Set();
  for (const v of productVariants) {
    if (v.shopify_active !== false) {
      activeFingerprints.add(`${v.option1 ?? ''}|${v.option2 ?? ''}|${v.option3 ?? ''}`);
    }
  }
  for (const v of productVariants) {
    if (v.shopify_active === false) {
      const fp = `${v.option1 ?? ''}|${v.option2 ?? ''}|${v.option3 ?? ''}`;
      if (activeFingerprints.has(fp)) toDelete.push(v.id);
    }
  }
}

if (toDelete.length > 0) {
  for (let i = 0; i < toDelete.length; i += 500) {
    const batch = toDelete.slice(i, i + 500);
    await supabase.from('product_variants').delete().in('id', batch);
  }
  log(`✓ ${toDelete.length} variante(s) dupliquée(s) supprimée(s)`);
} else {
  log('✓ Aucune duplication trouvée');
}

log(`🎉 Sync finalisé en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
