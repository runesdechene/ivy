import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');
    const { orderId } = await params;

    if (!shopId || !orderId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Récupérer la commande
    const { data: order, error: orderError } = await supabase
      .from('supplier_orders')
      .select('*')
      .eq('id', orderId)
      .eq('shop_id', shopId)
      .single();

    if (orderError || !order) {
      console.error('Error fetching order:', orderError);
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Récupérer les articles (pricing_string est déjà stocké dans la table)
    const { data: items, error: itemsError } = await supabase
      .from('supplier_order_items')
      .select('*')
      .eq('order_id', orderId)
      .order('sku');

    if (itemsError) {
      console.error('Error fetching items:', itemsError);
    }

    // Enrich items with illustration_url from products table.
    // Match via variant_id (may be "gid://shopify/ProductVariant/123" or "123")
    // against product_variants.shopify_id, then join to products.illustration_url.
    let enrichedItems = items || [];
    if (enrichedItems.length > 0) {
      const normalizeVariantId = (id: string | null): string | null =>
        id ? id.replace('gid://shopify/ProductVariant/', '') : null;

      const variantIds = enrichedItems
        .map(i => normalizeVariantId(i.variant_id))
        .filter((v): v is string => !!v);

      if (variantIds.length > 0) {
        const { data: variants } = await supabase
          .from('product_variants')
          .select('shopify_id, products!inner(shop_id, illustration_url)')
          .eq('products.shop_id', shopId)
          .in('shopify_id', variantIds);

        // Build map: variant shopify_id → illustration_url
        const illustrationMap: Record<string, string | null> = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (variants as any[] | null)?.forEach(v => {
          illustrationMap[v.shopify_id] = v.products?.illustration_url || null;
        });

        enrichedItems = enrichedItems.map(item => {
          const normalized = normalizeVariantId(item.variant_id);
          return {
            ...item,
            illustration_url: normalized ? (illustrationMap[normalized] || null) : null,
          };
        });
      }
    }

    return NextResponse.json({
      order,
      items: enrichedItems,
    });
  } catch (error) {
    console.error('Error fetching order:', error);
    return NextResponse.json({ error: 'Failed to fetch order' }, { status: 500 });
  }
}
