import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const SHOP_NAME = 'Runes de Chêne';

const { data: shops } = await supabase
  .from('shops')
  .select('id, name')
  .ilike('name', `%${SHOP_NAME}%`);
const shop = shops?.[0];
if (!shop) {
  console.error(`Shop "${SHOP_NAME}" introuvable`);
  process.exit(1);
}

const { data: products, error } = await supabase
  .from('products')
  .select(`
    id, title, status, product_type,
    option1_name, option2_name, option3_name,
    variants:product_variants(id, option1, option2, option3)
  `)
  .eq('shop_id', shop.id)
  .in('status', ['active', 'local', 'draft']);

if (error) {
  console.error(error);
  process.exit(1);
}

const SIZE_OPTION_NAMES = ['taille', 'size'];

function extractSize(variant, product) {
  const slots = [
    [product.option1_name, variant.option1],
    [product.option2_name, variant.option2],
    [product.option3_name, variant.option3],
  ];
  for (const [name, value] of slots) {
    if (name && SIZE_OPTION_NAMES.includes(String(name).toLowerCase()) && value) {
      return String(value).trim();
    }
  }
  return null;
}

// Group: product -> set of size notations used
const byProduct = new Map();

for (const p of products ?? []) {
  for (const v of p.variants ?? []) {
    const size = extractSize(v, p);
    if (!size) continue;
    const upper = size.toUpperCase();
    if (upper !== 'XXL' && upper !== '2XL') continue;
    if (!byProduct.has(p.id)) {
      byProduct.set(p.id, {
        title: p.title,
        product_type: p.product_type,
        status: p.status,
        notations: new Set(),
      });
    }
    byProduct.get(p.id).notations.add(upper);
  }
}

const rows = [...byProduct.values()].sort((a, b) =>
  (a.product_type || '').localeCompare(b.product_type || '') ||
  a.title.localeCompare(b.title),
);

const xxlOnly = rows.filter((r) => r.notations.has('XXL') && !r.notations.has('2XL'));
const twoXlOnly = rows.filter((r) => r.notations.has('2XL') && !r.notations.has('XXL'));
const both = rows.filter((r) => r.notations.has('XXL') && r.notations.has('2XL'));

const fmt = (r) => `  · [${r.product_type || '–'}] ${r.title}  (${r.status})`;

console.log(`\n=== Produits avec variante taille "XXL" ou "2XL" — shop: ${shop.name} ===\n`);

console.log(`▶ XXL uniquement (${xxlOnly.length})`);
xxlOnly.forEach((r) => console.log(fmt(r)));

console.log(`\n▶ 2XL uniquement (${twoXlOnly.length})`);
twoXlOnly.forEach((r) => console.log(fmt(r)));

if (both.length > 0) {
  console.log(`\n▶ Les DEUX notations sur le même produit (${both.length}) — à fusionner !`);
  both.forEach((r) => console.log(fmt(r)));
}

console.log(`\nTotal : ${rows.length} produits concernés.`);
