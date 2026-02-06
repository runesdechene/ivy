import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Resolve a variant ID that could be a Supabase UUID or a Shopify numeric ID
async function resolveVariantId(variantId: string): Promise<string | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(variantId);
  if (isUuid) return variantId;

  const { data } = await supabase
    .from('product_variants')
    .select('id')
    .eq('shopify_id', variantId)
    .single();

  return data?.id || null;
}

interface StockAdjustment {
  variantId: string;
  quantity: number; // Negative to decrease, positive to increase
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { shopId, locationId, items } = body as {
      shopId: string;
      locationId?: string;
      items: StockAdjustment[];
    };

    if (!shopId || !items || items.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Get shop for Shopify credentials
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('shopify_url, shopify_token')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      return NextResponse.json(
        { error: 'Shop not found' },
        { status: 404 }
      );
    }

    const results: { variantId: string; success: boolean; error?: string }[] = [];

    for (const item of items) {
      try {
        // Resolve variant ID (could be Shopify ID)
        const resolvedVariantId = await resolveVariantId(item.variantId);
        if (!resolvedVariantId) {
          results.push({ variantId: item.variantId, success: false, error: 'Variant not found' });
          continue;
        }

        // Get variant with inventory_item_id
        const { data: variant, error: variantError } = await supabase
          .from('product_variants')
          .select('id, inventory_item_id')
          .eq('id', resolvedVariantId)
          .single();

        if (variantError || !variant) {
          results.push({
            variantId: item.variantId,
            success: false,
            error: 'Variant not found',
          });
          continue;
        }

        // Update local inventory
        if (locationId) {
          // Get current inventory level
          const { data: currentLevel } = await supabase
            .from('inventory_levels')
            .select('quantity')
            .eq('variant_id', resolvedVariantId)
            .eq('location_id', locationId)
            .single();

          const newQuantity = (currentLevel?.quantity || 0) + item.quantity;

          const { error: updateError } = await supabase
            .from('inventory_levels')
            .upsert({
              variant_id: resolvedVariantId,
              location_id: locationId,
              quantity: newQuantity,
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'variant_id,location_id',
            });

          if (updateError) {
            console.error('Error updating local inventory:', updateError);
          }
        }

        // Sync with Shopify
        if (variant.inventory_item_id && locationId) {
          // Get Shopify location ID (locationId might already be a Shopify ID)
          const isLocationUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(locationId);
          let shopifyLocationId = locationId;
          if (isLocationUuid) {
            const { data: location } = await supabase
              .from('locations')
              .select('shopify_id')
              .eq('id', locationId)
              .single();
            shopifyLocationId = location?.shopify_id || locationId;
          }

          if (shopifyLocationId) {
            const shopifyResponse = await fetch(
              `https://${shop.shopify_url}/admin/api/2024-01/inventory_levels/adjust.json`,
              {
                method: 'POST',
                headers: {
                  'X-Shopify-Access-Token': shop.shopify_token,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  location_id: shopifyLocationId,
                  inventory_item_id: variant.inventory_item_id,
                  available_adjustment: item.quantity,
                }),
              }
            );

            if (!shopifyResponse.ok) {
              const errorData = await shopifyResponse.json();
              console.error('Shopify inventory adjust error:', errorData);
              results.push({
                variantId: item.variantId,
                success: false,
                error: `Shopify sync failed: ${shopifyResponse.status}`,
              });
              continue;
            }
          }
        }

        results.push({
          variantId: item.variantId,
          success: true,
        });

      } catch (itemError) {
        console.error('Error processing item:', itemError);
        results.push({
          variantId: item.variantId,
          success: false,
          error: 'Processing error',
        });
      }
    }

    const allSuccess = results.every(r => r.success);
    const successCount = results.filter(r => r.success).length;

    return NextResponse.json({
      success: allSuccess,
      message: `${successCount}/${items.length} ajustements effectués`,
      results,
    });

  } catch (error) {
    console.error('Error in POST /api/pos/stock/adjust:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
