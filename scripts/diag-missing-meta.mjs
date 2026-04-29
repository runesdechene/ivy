import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { data: shop } = await supabase
  .from('shops').select('id').ilike('name', '%Runes de Chêne%').single();

// Compter la cardinalité par produit
const { data: products } = await supabase
  .from('products')
  .select(`
    id, title, status, created_at,
    variants:product_variants(
      id, sku, cost, shopify_active,
      variant_metafields(namespace, key)
    )
  `)
  .eq('shop_id', shop.id)
  .in('status', ['active', 'local', 'draft']);

const { data: configs } = await supabase
  .from('metafield_config')
  .select('namespace, key, label')
  .eq('shop_id', shop.id)
  .eq('is_active', true);

console.log(`Configs métachamps actives : ${configs?.length || 0}`);
for (const c of configs || []) console.log(`  - ${c.namespace}.${c.key} (${c.label || ''})`);
console.log('');

const expectedMetaCount = configs?.length || 0;

// Pour chaque produit : compter variantes shopify_active sans cost et sans tous les métachamps
const issues = [];
for (const p of products) {
  const activeVariants = (p.variants || []).filter(v => v.shopify_active !== false);
  if (activeVariants.length === 0) continue;
  const noCost = activeVariants.filter(v => !v.cost || v.cost === 0).length;
  const noMeta = activeVariants.filter(v => (v.variant_metafields?.length || 0) === 0).length;
  const partialMeta = activeVariants.filter(v => {
    const c = v.variant_metafields?.length || 0;
    return c > 0 && c < expectedMetaCount;
  }).length;
  if (noCost > 0 || noMeta > 0 || partialMeta > 0) {
    issues.push({
      title: p.title,
      created: p.created_at?.slice(0, 10),
      total: activeVariants.length,
      noCost, noMeta, partialMeta,
    });
  }
}

issues.sort((a, b) => (b.created || '').localeCompare(a.created || ''));

console.log(`Produits avec variantes incomplètes : ${issues.length} / ${products.length}\n`);
console.log('created    | total | noCost | noMeta | partialMeta | titre');
console.log('-----------+-------+--------+--------+-------------+-----');
for (const r of issues.slice(0, 50)) {
  console.log(`${r.created} |  ${String(r.total).padStart(3)} |    ${String(r.noCost).padStart(3)} |    ${String(r.noMeta).padStart(3)} |        ${String(r.partialMeta).padStart(3)} | ${r.title}`);
}
if (issues.length > 50) console.log(`... et ${issues.length - 50} autres`);

const totalNoCost = issues.reduce((s, r) => s + r.noCost, 0);
const totalNoMeta = issues.reduce((s, r) => s + r.noMeta, 0);
const totalPartialMeta = issues.reduce((s, r) => s + r.partialMeta, 0);
console.log(`\nTotal variantes : noCost=${totalNoCost}, noMeta=${totalNoMeta}, partialMeta=${totalPartialMeta}`);
