import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';
import { normalizeSize, sizeDistance, computeWeight } from '@/lib/weights/sizes';

const PAGE_SIZE = 1000;
const SHOPIFY_API_VERSION = '2026-01';
const CONCURRENCY = 5;

interface WeightTypeRule {
  id: string;
  shop_id: string;
  product_type: string;
  reference_size: string;
  reference_grams: number;
  step_pct: number;
}

interface ProductRow {
  id: string;
  product_type: string | null;
}

interface VariantRow {
  id: string;
  sku: string | null;
  title: string | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  weight_grams: number | null;
  inventory_item_id: string | null;
  shopify_active: boolean | null;
  product_id: string;
}

interface Failure {
  variantId: string;
  sku: string | null;
  error: string;
}

const UPDATE_INVENTORY_WEIGHT_MUTATION = `
  mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem { id }
      userErrors { field message }
    }
  }
`;

async function fetchAllProducts(
  supabase: ReturnType<typeof createServerClient>,
  shopId: string
): Promise<ProductRow[]> {
  const rows: ProductRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('products')
      .select('id, product_type')
      .eq('shop_id', shopId)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as ProductRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function fetchAllVariants(
  supabase: ReturnType<typeof createServerClient>,
  productIds: string[]
): Promise<VariantRow[]> {
  const rows: VariantRow[] = [];
  const CHUNK = 200;
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const idsChunk = productIds.slice(i, i + CHUNK);
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('product_variants')
        .select('id, sku, title, option1, option2, option3, weight_grams, inventory_item_id, shopify_active, product_id')
        .in('product_id', idsChunk)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      rows.push(...(data as VariantRow[]));
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }
  return rows;
}

async function pushWeightToShopify(
  shopifyUrl: string,
  shopifyToken: string,
  inventoryItemId: string,
  grams: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const cleanUrl = shopifyUrl.replace(/\/$/, '');
    const response = await fetch(`https://${cleanUrl}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': shopifyToken,
      },
      body: JSON.stringify({
        query: UPDATE_INVENTORY_WEIGHT_MUTATION,
        variables: {
          id: `gid://shopify/InventoryItem/${inventoryItemId}`,
          input: { measurement: { weight: { unit: 'GRAMS', value: grams } } },
        },
      }),
    });

    const data = await response.json().catch(() => null);
    const userErrors = data?.data?.inventoryItemUpdate?.userErrors;

    if (!response.ok || data?.errors) {
      return { ok: false, error: data?.errors?.[0]?.message || `Shopify HTTP ${response.status}` };
    }
    if (userErrors && userErrors.length > 0) {
      return { ok: false, error: userErrors[0].message || 'Shopify userError' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Shopify fetch error' };
  }
}

// Exécute `items` via `worker` avec au plus `limit` appels concurrents.
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    const current = index++;
    if (current >= items.length) return;
    await worker(items[current]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { shopId, productType, overwrite } = body as {
      shopId?: string;
      productType?: string;
      overwrite?: boolean;
    };

    if (!shopId) {
      return NextResponse.json({ error: 'Missing shopId' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('shopify_url, shopify_token')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }

    let rulesQuery = supabase.from('weight_type_rules').select('*').eq('shop_id', shopId);
    if (productType) {
      rulesQuery = rulesQuery.eq('product_type', productType);
    }
    const { data: rulesData, error: rulesError } = await rulesQuery;

    if (rulesError) {
      return NextResponse.json({ error: rulesError.message }, { status: 500 });
    }

    const rules = (rulesData || []) as WeightTypeRule[];
    if (rules.length === 0) {
      return NextResponse.json(
        { error: productType ? 'Aucune règle pour ce type de produit' : 'Aucune règle définie' },
        { status: 404 }
      );
    }

    const products = await fetchAllProducts(supabase, shopId);
    const productTypeById = new Map<string, string>();
    for (const p of products) {
      productTypeById.set(p.id, p.product_type || 'Sans type');
    }

    const ruleByType = new Map<string, WeightTypeRule>();
    for (const rule of rules) {
      ruleByType.set(rule.product_type, rule);
    }

    const relevantProductIds = products
      .filter((p) => ruleByType.has(p.product_type || 'Sans type'))
      .map((p) => p.id);

    const variants = await fetchAllVariants(supabase, relevantProductIds);

    let filled = 0;
    let pushed = 0;
    let localOnly = 0;
    let unresolved = 0;
    const failures: Failure[] = [];

    const toProcess: { variant: VariantRow; weight: number }[] = [];

    for (const variant of variants) {
      const type = productTypeById.get(variant.product_id);
      if (!type) continue;
      const rule = ruleByType.get(type);
      if (!rule) continue;

      if (!overwrite && variant.weight_grams !== null) {
        continue; // ne remplit que les poids NULL par défaut
      }

      const resolvedSize =
        normalizeSize(variant.option1) ?? normalizeSize(variant.option2) ?? normalizeSize(variant.option3);

      if (!resolvedSize) {
        unresolved++;
        continue;
      }

      const distance = sizeDistance(rule.reference_size, resolvedSize);
      if (distance === null) {
        unresolved++;
        continue;
      }

      const weight = computeWeight(rule.reference_grams, rule.step_pct, distance);
      toProcess.push({ variant, weight });
    }

    await runWithConcurrency(toProcess, CONCURRENCY, async ({ variant, weight }) => {
      const canPushToShopify = !!variant.inventory_item_id && variant.shopify_active !== false;

      if (canPushToShopify) {
        // Shopify d'abord, Ivy ensuite : si Shopify refuse, on n'écrit pas dans Ivy.
        const result = await pushWeightToShopify(
          shop.shopify_url,
          shop.shopify_token,
          variant.inventory_item_id as string,
          weight
        );

        if (!result.ok) {
          failures.push({ variantId: variant.id, sku: variant.sku, error: result.error });
          return;
        }

        const { error: updateError } = await supabase
          .from('product_variants')
          .update({ weight_grams: weight })
          .eq('id', variant.id);

        if (updateError) {
          failures.push({ variantId: variant.id, sku: variant.sku, error: `Shopify ok, Ivy: ${updateError.message}` });
          return;
        }

        pushed++;
        filled++;
      } else {
        // Pas d'inventory_item_id vivant côté Shopify : on n'appelle pas l'API, on écrit en local.
        const { error: updateError } = await supabase
          .from('product_variants')
          .update({ weight_grams: weight })
          .eq('id', variant.id);

        if (updateError) {
          failures.push({ variantId: variant.id, sku: variant.sku, error: updateError.message });
          return;
        }

        localOnly++;
        filled++;
      }
    });

    return NextResponse.json({ filled, pushed, localOnly, unresolved, failures });
  } catch (error) {
    console.error('Error applying weight rules:', error);
    return NextResponse.json({ error: 'Failed to apply weight rules' }, { status: 500 });
  }
}
