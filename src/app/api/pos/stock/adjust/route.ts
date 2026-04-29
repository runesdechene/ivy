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
  productTitle?: string;
  variantTitle?: string;
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

    // Resolve locationId → Supabase UUID for stock_movements logging.
    // The HUB de stand passes a Shopify numeric ID (string), but
    // stock_movements.location_id is UUID FK → locations(id). Without this
    // resolution, every insert silently fails (type mismatch + FK violation),
    // leaving the table empty and breaking the Festival dashboard / study zones.
    // inventory_levels.location_id stays Shopify ID — it's a different schema.
    let locationUuid: string | null = null;
    if (locationId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(locationId);
      if (isUuid) {
        locationUuid = locationId;
      } else {
        const { data: loc } = await supabase
          .from('locations')
          .select('id')
          .eq('shopify_id', locationId)
          .maybeSingle();
        locationUuid = loc?.id || null;
      }
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
    const movementsToLog: {
      shop_id: string;
      location_id: string | null;
      variant_id: string;
      product_title: string;
      variant_title: string | null;
      quantity: number;
    }[] = [];

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

        // Queue movement for logging (location_id must be UUID, not Shopify ID)
        if (item.productTitle) {
          movementsToLog.push({
            shop_id: shopId,
            location_id: locationUuid,
            variant_id: resolvedVariantId,
            product_title: item.productTitle,
            variant_title: item.variantTitle || null,
            quantity: item.quantity,
          });
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

    // Log movements — aggregate by variant + day (daily totals only)
    if (movementsToLog.length > 0) {
      // Group by variant_id to aggregate quantities
      const aggregated = new Map<string, typeof movementsToLog[0]>();
      for (const m of movementsToLog) {
        const existing = aggregated.get(m.variant_id);
        if (existing) {
          existing.quantity += m.quantity;
        } else {
          aggregated.set(m.variant_id, { ...m });
        }
      }

      // Upsert: if a row already exists for this variant + today, add to it
      for (const movement of aggregated.values()) {
        const today = new Date().toISOString().split('T')[0];

        let existingQuery = supabase
          .from('stock_movements')
          .select('id, quantity')
          .eq('shop_id', movement.shop_id)
          .eq('variant_id', movement.variant_id)
          .eq('moved_on', today);

        if (movement.location_id) {
          existingQuery = existingQuery.eq('location_id', movement.location_id);
        } else {
          existingQuery = existingQuery.is('location_id', null);
        }

        const { data: existing } = await existingQuery.maybeSingle();

        if (existing) {
          const { error: updateErr } = await supabase
            .from('stock_movements')
            .update({ quantity: existing.quantity + movement.quantity })
            .eq('id', existing.id);
          if (updateErr) {
            console.error('stock_movements update failed:', updateErr, { movement });
          }
        } else {
          const { error: insertErr } = await supabase
            .from('stock_movements')
            .insert({ ...movement, moved_on: today });
          if (insertErr) {
            console.error('stock_movements insert failed:', insertErr, { movement });
          }
        }
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
