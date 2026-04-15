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
    // supplier_order_items.variant_id is a Supabase UUID pointing to product_variants.id.
    // Two-step join: variant.id → product_id, then product_id → illustration_url.
    let enrichedItems = items || [];
    if (enrichedItems.length > 0) {
      const variantIds = enrichedItems
        .map(i => i.variant_id)
        .filter((v): v is string => !!v);

      if (variantIds.length > 0) {
        // Step 1: resolve variant UUIDs → product_id
        const { data: variants, error: varErr } = await supabase
          .from('product_variants')
          .select('id, product_id')
          .in('id', variantIds);

        if (varErr) console.error('[illustration enrich] variants query error:', varErr);

        const variantToProduct: Record<string, string> = {};
        variants?.forEach(v => { variantToProduct[v.id] = v.product_id; });

        // Step 2: products by id → illustration_url (scoped to shop)
        const productIds = [...new Set(Object.values(variantToProduct))];
        const productToIllustration: Record<string, string | null> = {};

        if (productIds.length > 0) {
          const { data: productsData, error: prodErr } = await supabase
            .from('products')
            .select('id, illustration_url')
            .eq('shop_id', shopId)
            .in('id', productIds);

          if (prodErr) console.error('[illustration enrich] products query error:', prodErr);
          productsData?.forEach(p => { productToIllustration[p.id] = p.illustration_url; });
        }

        enrichedItems = enrichedItems.map(item => {
          if (!item.variant_id) return { ...item, illustration_url: null };
          const productId = variantToProduct[item.variant_id] || null;
          return {
            ...item,
            illustration_url: productId ? (productToIllustration[productId] || null) : null,
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
