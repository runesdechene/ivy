import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

interface RefillLine {
  variantId: string;
  quantity: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: containerId } = await params;

  let body: { shopId?: string; orderId?: string; lines?: RefillLine[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { shopId, orderId, lines } = body;

  if (!shopId) {
    return NextResponse.json({ error: 'shopId required' }, { status: 400 });
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json({ error: 'Aucune ligne à ajouter' }, { status: 400 });
  }

  const cleanLines = lines.filter(
    (l) =>
      l &&
      typeof l.variantId === 'string' &&
      typeof l.quantity === 'number' &&
      l.quantity > 0,
  );
  if (cleanLines.length === 0) {
    return NextResponse.json({ error: 'Toutes les quantités sont à 0' }, { status: 400 });
  }

  const supabase = createServerClient();

  // 1. Verify container
  const { data: container } = await supabase
    .from('container_instances')
    .select('id, shop_id')
    .eq('id', containerId)
    .maybeSingle();
  if (!container || container.shop_id !== shopId) {
    return NextResponse.json({ error: 'Container not found' }, { status: 404 });
  }

  // 2. Determine target supplier_order
  let targetOrderId: string;
  let targetOrderNumber: string;

  if (orderId) {
    const { data: existing } = await supabase
      .from('supplier_orders')
      .select('id, order_number, status, shop_id')
      .eq('id', orderId)
      .maybeSingle();
    if (!existing || existing.shop_id !== shopId) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (existing.status !== 'draft') {
      return NextResponse.json(
        { error: "Cette commande n'est plus modifiable (status ≠ draft)" },
        { status: 409 },
      );
    }
    targetOrderId = existing.id;
    targetOrderNumber = existing.order_number;
  } else {
    const { count } = await supabase
      .from('supplier_orders')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shopId);
    const newNumber = `BATCH-${String((count || 0) + 1).padStart(4, '0')}`;
    const { data: newOrder, error: createErr } = await supabase
      .from('supplier_orders')
      .insert({
        shop_id: shopId,
        order_number: newNumber,
        status: 'draft',
      })
      .select('id, order_number')
      .single();
    if (createErr || !newOrder) {
      return NextResponse.json(
        { error: createErr?.message || 'Failed to create order' },
        { status: 500 },
      );
    }
    targetOrderId = newOrder.id;
    targetOrderNumber = newOrder.order_number;
  }

  // 3. Lookup variant info — cost, shopify_id, title (Shopify-formatted with " / "),
  //    sku, parent product title. Tout doit matcher exactement le format utilisé par
  //    POST /api/suppliers/orders/[orderId]/items (le flow standard d'ajout de
  //    produits) sinon le groupement par variantKey de la page commande casse et
  //    les variantes apparaissent en doublon.
  const variantIds = cleanLines.map((l) => l.variantId);
  const { data: variantsInfo } = await supabase
    .from('product_variants')
    .select('id, sku, title, cost, shopify_id, product:products(title)')
    .in('id', variantIds);

  type VariantInfo = {
    sku: string | null;
    variantTitle: string | null;
    productTitle: string;
    cost: number;
    shopifyId: string | null;
  };
  const variantInfoById = new Map<string, VariantInfo>();
  for (const v of (variantsInfo ?? []) as Array<{
    id: string;
    sku: string | null;
    title: string | null;
    cost: number | null;
    shopify_id: string | null;
    product: { title?: string | null } | { title?: string | null }[] | null;
  }>) {
    const product = Array.isArray(v.product) ? v.product[0] : v.product;
    variantInfoById.set(v.id, {
      sku: v.sku,
      variantTitle: v.title, // ex: "Black / M" (format Shopify natif)
      productTitle: product?.title || 'Produit inconnu',
      cost: Number(v.cost) || 0,
      shopifyId: v.shopify_id,
    });
  }

  // 4. Récupération des métachamps (même logique que /items) pour que les
  //    price rules + l'affichage métachamps fonctionnent en aval.
  const { data: metafieldConfigs } = await supabase
    .from('metafield_config')
    .select('namespace, key, display_name')
    .eq('shop_id', shopId)
    .eq('is_active', true);

  let variantMetafieldsMap: Record<string, Record<string, string>> = {};
  if (metafieldConfigs && metafieldConfigs.length > 0) {
    const shopifyIds = Array.from(variantInfoById.values())
      .map((i) => i.shopifyId)
      .filter((s): s is string => !!s);
    if (shopifyIds.length > 0) {
      variantMetafieldsMap = await fetchVariantMetafields(
        supabase,
        shopId,
        shopifyIds,
        metafieldConfigs,
      );
    }
  }

  // 5. Build per-unit rows (1 ligne = 1 unité, quantity toujours 1) — strictement
  //    aligné avec l'endpoint standard. Permet le groupement correct côté page
  //    commande de stock + le suivi unitaire (validation, impression, etc.).
  type ItemInsert = {
    order_id: string;
    variant_id: string;
    product_title: string;
    variant_title: string | null;
    sku: string | null;
    quantity: number;
    unit_price: number;
    line_total: number;
    metafields: Record<string, string>;
    is_validated: boolean;
  };
  const itemsToInsert: ItemInsert[] = [];
  const errors: Array<{ variantId: string; reason: string }> = [];
  let unitsAdded = 0;
  const distinctVariants = new Set<string>();

  for (const line of cleanLines) {
    const info = variantInfoById.get(line.variantId);
    if (!info) {
      errors.push({ variantId: line.variantId, reason: 'Variant not found' });
      continue;
    }
    const metafields = info.shopifyId
      ? variantMetafieldsMap[info.shopifyId] || {}
      : {};
    for (let i = 0; i < line.quantity; i++) {
      itemsToInsert.push({
        order_id: targetOrderId,
        variant_id: line.variantId,
        product_title: info.productTitle,
        variant_title: info.variantTitle,
        sku: info.sku,
        quantity: 1,
        unit_price: info.cost,
        line_total: info.cost,
        metafields,
        is_validated: false,
      });
    }
    unitsAdded += line.quantity;
    distinctVariants.add(line.variantId);
  }

  if (itemsToInsert.length > 0) {
    const { error: insErr } = await supabase
      .from('supplier_order_items')
      .insert(itemsToInsert);
    if (insErr) {
      console.error('refill insert items failed:', insErr);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  // 6. Recompute order totals (subtotal sur items validés uniquement)
  const { data: allItems } = await supabase
    .from('supplier_order_items')
    .select('line_total, is_validated')
    .eq('order_id', targetOrderId);
  const subtotal =
    allItems?.filter((i) => i.is_validated).reduce(
      (sum, i) => sum + (Number(i.line_total) || 0),
      0,
    ) || 0;
  const { data: orderRow } = await supabase
    .from('supplier_orders')
    .select('balance_adjustment')
    .eq('id', targetOrderId)
    .single();
  const balance = Number(orderRow?.balance_adjustment) || 0;
  const totalHt = subtotal + balance;
  await supabase
    .from('supplier_orders')
    .update({
      subtotal,
      total_ht: totalHt,
      total_ttc: totalHt * 1.2,
      updated_at: new Date().toISOString(),
    })
    .eq('id', targetOrderId);

  return NextResponse.json({
    orderId: targetOrderId,
    orderNumber: targetOrderNumber,
    unitsAdded,
    variantsAdded: distinctVariants.size,
    errors: errors.length > 0 ? errors : undefined,
  });
}

// Récupère les métachamps Shopify des variantes (copie de la logique de
// POST /api/suppliers/orders/[orderId]/items pour cohérence stricte).
async function fetchVariantMetafields(
  supabase: ReturnType<typeof createServerClient>,
  shopId: string,
  variantShopifyIds: string[],
  metafieldConfigs: Array<{ namespace: string; key: string; display_name: string }>,
): Promise<Record<string, Record<string, string>>> {
  try {
    const { data: shop } = await supabase
      .from('shops')
      .select('shopify_url, shopify_token')
      .eq('id', shopId)
      .single();

    if (!shop) return {};

    const variantGids = variantShopifyIds.map(
      (id) => `gid://shopify/ProductVariant/${id}`,
    );

    const allMetafieldsQuery = `
      query GetVariantMetafields($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            sku
            metafields(first: 50) {
              edges { node { namespace key value } }
            }
          }
        }
      }
    `;

    const response = await fetch(
      `https://${shop.shopify_url}/admin/api/2024-01/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': shop.shopify_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: allMetafieldsQuery,
          variables: { ids: variantGids },
        }),
      },
    );

    if (!response.ok) return {};
    const data = await response.json();
    if (data.errors) return {};

    const result: Record<string, Record<string, string>> = {};
    const configuredKeysMap = new Map<
      string,
      { namespace: string; key: string; display_name: string }
    >();
    for (const c of metafieldConfigs) {
      configuredKeysMap.set(`${c.namespace}.${c.key}`.toLowerCase(), c);
    }

    for (const node of data.data?.nodes || []) {
      if (!node?.id) continue;
      const shopifyId = String(node.id).replace('gid://shopify/ProductVariant/', '');
      result[shopifyId] = {};
      for (const edge of node.metafields?.edges || []) {
        const mf = edge.node;
        if (mf && mf.value) {
          const fullKeyLower = `${mf.namespace}.${mf.key}`.toLowerCase();
          const config = configuredKeysMap.get(fullKeyLower);
          if (config) {
            const displayName = config.display_name || `${mf.namespace}.${mf.key}`;
            result[shopifyId][displayName] = mf.value;
          }
        }
      }
    }
    return result;
  } catch (err) {
    console.error('fetchVariantMetafields failed:', err);
    return {};
  }
}
