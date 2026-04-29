// Fixe les variantes shopify_active=true qui ont cost=0/null OU pas de metafields complets,
// en tapant Shopify directement (REST inventory_items + GraphQL metafields).
// Réplique la logique de phaseCosts + syncVariantMetafields, sans Netlify timeout.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const t0 = Date.now();
const log = (msg) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

const { data: shop } = await supabase
  .from('shops').select('id, shopify_url, shopify_token').ilike('name', '%Runes de Chêne%').single();

// 1. Charger toutes les variantes actives non-locales
log('🔍 Chargement des variantes actives...');
const { data: products } = await supabase
  .from('products').select('id').eq('shop_id', shop.id).neq('status', 'local');
const productUuids = (products || []).map(p => p.id);

const variants = [];
for (let i = 0; i < productUuids.length; i += 50) {
  const batch = productUuids.slice(i, i + 50);
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from('product_variants')
      .select('id, shopify_id, inventory_item_id, cost')
      .in('product_id', batch)
      .eq('shopify_active', true)
      .order('id')
      .range(from, from + 999);
    if (data && data.length > 0) {
      variants.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    } else break;
  }
}
log(`✓ ${variants.length} variantes actives`);

// ============ PHASE 1 : COST ============
const variantsNeedingCost = variants.filter(v => (!v.cost || v.cost === 0) && v.inventory_item_id);
log(`💰 ${variantsNeedingCost.length} variantes ont cost=0 — fetch Shopify...`);

if (variantsNeedingCost.length > 0) {
  const invIdToVariantUuid = new Map();
  for (const v of variantsNeedingCost) invIdToVariantUuid.set(v.inventory_item_id, v.id);

  const ids = [...invIdToVariantUuid.keys()];
  let costUpdated = 0;
  let costStillZero = 0;

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = `https://${shop.shopify_url}/admin/api/2024-01/inventory_items.json?ids=${batch.join(',')}`;
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': shop.shopify_token } });
    if (!res.ok) {
      log(`  ❌ Batch ${Math.floor(i / 50) + 1}: HTTP ${res.status}`);
      continue;
    }
    const data = await res.json();
    const updates = (data.inventory_items || []).map(item => {
      const cost = item.cost ? parseFloat(item.cost) : 0;
      const uuid = invIdToVariantUuid.get(String(item.id));
      if (!uuid) return null;
      if (cost > 0) costUpdated++;
      else costStillZero++;
      return supabase.from('product_variants').update({ cost }).eq('id', uuid);
    }).filter(Boolean);
    await Promise.all(updates);
    log(`  └─ Batch ${Math.floor(i / 50) + 1}/${Math.ceil(ids.length / 50)} OK`);
  }
  log(`✓ Cost mis à jour : ${costUpdated} avec cost>0, ${costStillZero} restent à 0 (vraiment pas de cost sur Shopify)`);
}

// ============ PHASE 2 : METAFIELDS ============
log('\n🏷️ Synchronisation des métachamps...');

const { data: configs } = await supabase
  .from('metafield_config')
  .select('namespace, key, display_name')
  .eq('shop_id', shop.id)
  .eq('is_active', true);

if (!configs || configs.length === 0) {
  log('⚠️ Aucune config metafield active — skip');
  process.exit(0);
}
log(`Configs actives : ${configs.map(c => c.display_name || c.namespace + '.' + c.key).join(', ')}`);

// Identify variants with missing metafields
const variantUuids = variants.map(v => v.id);
const metaByVariant = new Map(); // variantUuid -> Set<"namespace.key">
for (let i = 0; i < variantUuids.length; i += 200) {
  const batch = variantUuids.slice(i, i + 200);
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from('variant_metafields')
      .select('variant_id, namespace, key')
      .in('variant_id', batch)
      .order('variant_id')
      .range(from, from + 999);
    if (data && data.length > 0) {
      for (const mf of data) {
        if (!metaByVariant.has(mf.variant_id)) metaByVariant.set(mf.variant_id, new Set());
        metaByVariant.get(mf.variant_id).add(`${mf.namespace}.${mf.key}`);
      }
      if (data.length < 1000) break;
      from += 1000;
    } else break;
  }
}

const expectedKeys = configs.map(c => `${c.namespace}.${c.key}`);
const variantsNeedingMeta = variants.filter(v => {
  const has = metaByVariant.get(v.id) || new Set();
  return !expectedKeys.every(k => has.has(k));
});
log(`📌 ${variantsNeedingMeta.length} variantes ont des métachamps incomplets`);

if (variantsNeedingMeta.length === 0) {
  log('✓ Rien à faire');
  process.exit(0);
}

// Build GraphQL query
const mfFields = configs.map((c, i) =>
  `mf${i}: metafield(namespace: "${c.namespace}", key: "${c.key}") { namespace key value type }`
).join('\n          ');
const query = `
  query GetVariantMetafields($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        ${mfFields}
      }
    }
  }
`;

const shopifyIds = variantsNeedingMeta.map(v => v.shopify_id);
const idMap = new Map(variantsNeedingMeta.map(v => [v.shopify_id, v.id]));
const allRows = [];
const now = new Date().toISOString();
const batchSize = 200;

for (let i = 0; i < shopifyIds.length; i += batchSize) {
  const batch = shopifyIds.slice(i, i + batchSize);
  const gids = batch.map(id => `gid://shopify/ProductVariant/${id}`);
  const res = await fetch(`https://${shop.shopify_url}/admin/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': shop.shopify_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { ids: gids } }),
  });
  if (!res.ok) {
    log(`  ❌ GraphQL batch ${Math.floor(i / batchSize) + 1}: HTTP ${res.status}`);
    continue;
  }
  const data = await res.json();
  if (data.errors) {
    log(`  ⚠️ GraphQL errors: ${data.errors[0]?.message}`);
  }
  const nodes = data.data?.nodes || [];
  for (const node of nodes) {
    if (!node?.id) continue;
    const sid = node.id.replace('gid://shopify/ProductVariant/', '');
    const uuid = idMap.get(sid);
    if (!uuid) continue;
    for (let ci = 0; ci < configs.length; ci++) {
      const mf = node[`mf${ci}`];
      if (!mf?.value) continue;
      allRows.push({
        variant_id: uuid,
        namespace: mf.namespace,
        key: mf.key,
        value: mf.value,
        type: mf.type || 'single_line_text_field',
        synced_at: now,
      });
    }
  }
  // Throttle gentle pause
  if (data.extensions?.cost?.throttleStatus?.currentlyAvailable < 100) {
    await new Promise(r => setTimeout(r, 500));
  }
  log(`  └─ Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(shopifyIds.length / batchSize)} (${nodes.length} nodes, ${allRows.length} rows total)`);
}

if (allRows.length > 0) {
  for (let i = 0; i < allRows.length; i += 500) {
    const batch = allRows.slice(i, i + 500);
    const { error } = await supabase
      .from('variant_metafields')
      .upsert(batch, { onConflict: 'variant_id,namespace,key' });
    if (error) log(`  ❌ Upsert: ${error.message}`);
  }
  log(`✓ ${allRows.length} métachamps insérés/mis à jour`);
}

log(`\n🎉 Terminé en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
