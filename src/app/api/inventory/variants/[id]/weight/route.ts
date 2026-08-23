import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

const SHOPIFY_API_VERSION = '2026-01';

const UPDATE_INVENTORY_WEIGHT_MUTATION = `
  mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem { id }
      userErrors { field message }
    }
  }
`;

// Poids saisi à la main pour une variante encore sans poids. Même discipline que
// l'application en masse : Shopify d'abord, Ivy ensuite.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { shopId, weightGrams } = body as { shopId?: string; weightGrams?: number };

    if (!shopId || !weightGrams || weightGrams <= 0) {
      return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 });
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

    const { data: variant, error: variantError } = await supabase
      .from('product_variants')
      .select('id, product_id, inventory_item_id, shopify_active')
      .eq('id', id)
      .single();

    if (variantError || !variant) {
      return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
    }

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('shop_id')
      .eq('id', variant.product_id)
      .single();

    if (productError || !product || product.shop_id !== shopId) {
      return NextResponse.json({ error: 'Variant not found for this shop' }, { status: 404 });
    }

    const weight = Math.round(weightGrams);
    const canPushToShopify = !!variant.inventory_item_id && variant.shopify_active !== false;

    if (canPushToShopify) {
      const cleanUrl = shop.shopify_url.replace(/\/$/, '');
      const response = await fetch(`https://${cleanUrl}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': shop.shopify_token,
        },
        body: JSON.stringify({
          query: UPDATE_INVENTORY_WEIGHT_MUTATION,
          variables: {
            id: `gid://shopify/InventoryItem/${variant.inventory_item_id}`,
            input: { measurement: { weight: { unit: 'GRAMS', value: weight } } },
          },
        }),
      });

      const data = await response.json().catch(() => null);
      const userErrors = data?.data?.inventoryItemUpdate?.userErrors;

      if (!response.ok || data?.errors || (userErrors && userErrors.length > 0)) {
        const errMsg = userErrors?.[0]?.message || data?.errors?.[0]?.message || 'Shopify API error';
        return NextResponse.json({ error: errMsg }, { status: 502 });
      }
    }

    const { error: updateError } = await supabase
      .from('product_variants')
      .update({ weight_grams: weight })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, pushed: canPushToShopify, weightGrams: weight });
  } catch (error) {
    console.error('Error updating variant weight:', error);
    return NextResponse.json({ error: 'Failed to update variant weight' }, { status: 500 });
  }
}
