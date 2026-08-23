import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Instantané d'un passage en douane.
 *
 * Au clic, on fige l'état du stock d'un emplacement : quelles variantes, en
 * quelle quantité, avec quels coûts décomposés et quel poids. Rien ne le
 * modifie ensuite — même si le stock bouge, même si un produit est supprimé.
 * C'est ce qui rendra le formulaire 11.74 exact au retour.
 */

export interface SnapshotItem {
  variant_id: string;
  product_title: string;
  product_type: string | null;
  image_url: string | null;
  variant_title: string | null;
  size: string | null;
  color: string | null;
  qty_departed: number;
  weight_grams: number | null;
  unit_cost_textile: number | null;
  unit_cost_print: number | null;
  unit_price_eur: number;
  incomplete: boolean;
}

const SIZE_NAMES = ['taille', 'size'];
const COLOR_NAMES = ['couleur', 'color', 'coloris'];

interface VariantRow {
  id: string;
  product_id: string;
  title: string | null;
  sku: string | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  cost: number | null;
  price: number | null;
  weight_grams: number | null;
}

interface ProductRow {
  id: string;
  title: string;
  product_type: string | null;
  image_url: string | null;
  option1_name: string | null;
  option2_name: string | null;
  option3_name: string | null;
}

/** PostgREST plafonne un select à 1000 lignes ; un range sans order est instable. */
async function page<T>(
  supabase: SupabaseClient,
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as T[];
    if (chunk.length === 0) break;
    out.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return out;
}

function optionOf(v: VariantRow, p: ProductRow, names: string[]): string | null {
  const pairs: [string | null, string | null][] = [
    [p.option1_name, v.option1],
    [p.option2_name, v.option2],
    [p.option3_name, v.option3],
  ];
  for (const [name, value] of pairs) {
    if (name && value && names.includes(name.trim().toLowerCase())) return value;
  }
  return null;
}

/**
 * Construit l'instantané des variantes en stock à un emplacement.
 *
 * La décomposition du coût rejoue la règle de prix, comme le fait
 * `apply-ivy-stream` : textile = base_price + majorations d'option,
 * impression = majorations de métachamp. Un écart avec `product_variants.cost`
 * n'est jamais corrigé en silence : la ligne est marquée `incomplete`.
 */
export async function buildSnapshot(
  supabase: SupabaseClient,
  shopId: string,
  locationShopifyId: string,
): Promise<SnapshotItem[]> {
  const levels = await page<{ variant_id: string; quantity: number }>(supabase, (a, b) =>
    supabase
      .from('inventory_levels')
      .select('variant_id, quantity')
      .eq('location_id', locationShopifyId)
      .gt('quantity', 0)
      .order('variant_id')
      .range(a, b),
  );

  const variants = await page<VariantRow>(supabase, (a, b) =>
    supabase
      .from('product_variants')
      .select('id, product_id, title, sku, option1, option2, option3, cost, price, weight_grams')
      .order('id')
      .range(a, b),
  );

  const products = await page<ProductRow>(supabase, (a, b) =>
    supabase
      .from('products')
      .select('id, title, product_type, image_url, option1_name, option2_name, option3_name')
      .eq('shop_id', shopId)
      .order('id')
      .range(a, b),
  );

  const rules = await page<{
    id: string; sku: string | null; base_price: number | null;
    product_type: string | null; is_active: boolean | null;
  }>(supabase, (a, b) =>
    supabase
      .from('price_rules')
      .select('id, sku, base_price, product_type, is_active')
      .eq('shop_id', shopId)
      .order('id')
      .range(a, b),
  );

  const mods = await page<{
    price_rule_id: string; metafield_namespace: string; metafield_key: string;
    metafield_value: string; modifier_amount: number | null;
  }>(supabase, (a, b) =>
    supabase
      .from('price_rule_modifiers')
      .select('price_rule_id, metafield_namespace, metafield_key, metafield_value, modifier_amount')
      .order('id')
      .range(a, b),
  );

  const optMods = await page<{
    price_rule_id: string; option_name: string | null;
    option_value: string | null; modifier_amount: number | null;
  }>(supabase, (a, b) =>
    supabase
      .from('price_rule_option_modifiers')
      .select('price_rule_id, option_name, option_value, modifier_amount')
      .order('id')
      .range(a, b),
  );

  const V = new Map(variants.map(v => [v.id, v]));
  const P = new Map(products.map(p => [p.id, p]));

  const metaByVariant = new Map<string, { namespace: string; key: string; value: string | null }[]>();
  const ids = levels.map(l => l.variant_id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from('variant_metafields')
      .select('variant_id, namespace, key, value')
      .in('variant_id', ids.slice(i, i + 200));
    for (const mf of (data ?? []) as { variant_id: string; namespace: string; key: string; value: string | null }[]) {
      const l = metaByVariant.get(mf.variant_id) ?? [];
      l.push(mf);
      metaByVariant.set(mf.variant_id, l);
    }
  }

  const modsByRule = new Map<string, typeof mods>();
  for (const m of mods) {
    const l = modsByRule.get(m.price_rule_id) ?? [];
    l.push(m);
    modsByRule.set(m.price_rule_id, l);
  }
  const optByRule = new Map<string, typeof optMods>();
  for (const m of optMods) {
    const l = optByRule.get(m.price_rule_id) ?? [];
    l.push(m);
    optByRule.set(m.price_rule_id, l);
  }

  const out: SnapshotItem[] = [];

  for (const lvl of levels) {
    const v = V.get(lvl.variant_id);
    if (!v) continue;
    const p = P.get(v.product_id);
    if (!p) continue;

    const sku = (v.sku ?? '').toUpperCase();
    const rule = rules.find(
      r =>
        r.is_active !== false &&
        sku.startsWith((r.sku ?? '').toUpperCase()) &&
        (!r.product_type || r.product_type === p.product_type),
    );

    let textile: number | null = null;
    let print: number | null = null;
    let mismatch = false;

    if (rule) {
      textile = Number(rule.base_price) || 0;
      print = 0;
      const metafields = metaByVariant.get(v.id) ?? [];
      for (const mod of modsByRule.get(rule.id) ?? []) {
        const hit = metafields.find(
          mf => mf.namespace === mod.metafield_namespace &&
                mf.key === mod.metafield_key &&
                mf.value === mod.metafield_value,
        );
        if (hit) print += Number(mod.modifier_amount) || 0;
      }
      const selected: { name: string; value: string }[] = [];
      if (v.option1) selected.push({ name: p.option1_name ?? 'Option 1', value: v.option1 });
      if (v.option2) selected.push({ name: p.option2_name ?? 'Option 2', value: v.option2 });
      if (v.option3) selected.push({ name: p.option3_name ?? 'Option 3', value: v.option3 });
      for (const om of optByRule.get(rule.id) ?? []) {
        const hit = selected.find(
          o => o.name.toLowerCase() === (om.option_name ?? '').toLowerCase() &&
               o.value.toLowerCase() === (om.option_value ?? '').toLowerCase(),
        );
        if (hit) textile += Number(om.modifier_amount) || 0;
      }
      const total = Math.round((textile + print) * 100) / 100;
      mismatch = Math.abs(total - (Number(v.cost) || 0)) >= 0.005;
    }

    const price = Number(v.price) || 0;

    out.push({
      variant_id: v.id,
      product_title: p.title,
      product_type: p.product_type,
      image_url: p.image_url,
      variant_title: v.title,
      size: optionOf(v, p, SIZE_NAMES) ?? v.option2,
      color: optionOf(v, p, COLOR_NAMES) ?? v.option1,
      qty_departed: lvl.quantity,
      weight_grams: v.weight_grams,
      unit_cost_textile: textile,
      unit_cost_print: print,
      unit_price_eur: price,
      incomplete: !v.weight_grams || !rule || mismatch || !price,
    });
  }

  return out;
}
