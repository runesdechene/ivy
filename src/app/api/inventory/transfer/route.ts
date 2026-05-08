import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  resolveVariantId,
  resolveLocationUuid,
  resolveLocationShopifyId,
  isUuid,
} from '@/lib/supabase/resolve';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface TransferItem {
  variantId: string;
  quantity: number;
  productTitle: string;
  variantTitle?: string;
}

interface TransferRequest {
  shopId: string;
  sourceLocationId: string;
  destLocationId: string;
  items: TransferItem[];
}

interface ItemResult {
  variantId: string;
  success: boolean;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TransferRequest;
    const { shopId, sourceLocationId, destLocationId, items } = body;

    if (!shopId || !sourceLocationId || !destLocationId || !items || items.length === 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (sourceLocationId === destLocationId) {
      return NextResponse.json(
        { error: 'Source and destination must differ' },
        { status: 400 },
      );
    }

    if (items.some((it) => !it.variantId || !it.quantity || it.quantity <= 0)) {
      return NextResponse.json(
        { error: 'Each item needs a positive quantity and a variantId' },
        { status: 400 },
      );
    }

    const sourceLocationUuid = await resolveLocationUuid(supabase, sourceLocationId);
    const destLocationUuid = await resolveLocationUuid(supabase, destLocationId);

    const sourceLocationShopifyId = isUuid(sourceLocationId)
      ? await resolveLocationShopifyId(supabase, sourceLocationId)
      : sourceLocationId;
    const destLocationShopifyId = isUuid(destLocationId)
      ? await resolveLocationShopifyId(supabase, destLocationId)
      : destLocationId;

    if (!sourceLocationShopifyId || !destLocationShopifyId) {
      return NextResponse.json({ error: 'Location resolution failed' }, { status: 400 });
    }

    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('shopify_url, shopify_token')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }

    const results: ItemResult[] = [];
    const today = new Date().toISOString().split('T')[0];

    for (const item of items) {
      try {
        const resolvedVariantId = await resolveVariantId(supabase, item.variantId);
        if (!resolvedVariantId) {
          results.push({ variantId: item.variantId, success: false, error: 'Variant not found' });
          continue;
        }

        const { data: variant, error: variantError } = await supabase
          .from('product_variants')
          .select('id, inventory_item_id, shopify_active')
          .eq('id', resolvedVariantId)
          .single();

        if (variantError || !variant) {
          results.push({ variantId: item.variantId, success: false, error: 'Variant not found' });
          continue;
        }

        const { data: sourceLevel } = await supabase
          .from('inventory_levels')
          .select('quantity')
          .eq('variant_id', resolvedVariantId)
          .eq('location_id', sourceLocationShopifyId)
          .maybeSingle();

        const sourceQty = Math.max(0, sourceLevel?.quantity ?? 0);
        if (item.quantity > sourceQty) {
          results.push({
            variantId: item.variantId,
            success: false,
            error: `Stock insuffisant : ${sourceQty} dispo, demandé ${item.quantity}`,
          });
          continue;
        }

        // Skip Shopify pour les variantes purement locales :
        // - Pas d'inventory_item_id (jamais existé sur Shopify)
        // - shopify_active=false (existait mais a été supprimée côté Shopify, l'inventory_item_id stocké est stale)
        if (variant.inventory_item_id && variant.shopify_active !== false) {
          // Shopify a déprécié POST /inventory_levels/adjust.json en REST.
          // On utilise la mutation GraphQL inventoryAdjustQuantities qui accepte
          // les 2 changes (source -X, dest +X) en un seul appel atomique.
          const graphqlEndpoint = `https://${shop.shopify_url}/admin/api/2026-01/graphql.json`;
          const inventoryItemGid = `gid://shopify/InventoryItem/${variant.inventory_item_id}`;
          const sourceLocationGid = `gid://shopify/Location/${sourceLocationShopifyId}`;
          const destLocationGid = `gid://shopify/Location/${destLocationShopifyId}`;

          const mutation = `
            mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
              inventoryAdjustQuantities(input: $input) {
                userErrors { field message }
                inventoryAdjustmentGroup { id }
              }
            }
          `;

          const variables = {
            input: {
              reason: 'movement_created',
              name: 'available',
              referenceDocumentUri: `logistics://ivy/transfer/${shopId}/${today}`,
              changes: [
                {
                  delta: -item.quantity,
                  inventoryItemId: inventoryItemGid,
                  locationId: sourceLocationGid,
                },
                {
                  delta: item.quantity,
                  inventoryItemId: inventoryItemGid,
                  locationId: destLocationGid,
                },
              ],
            },
          };

          const shopifyResponse = await fetch(graphqlEndpoint, {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': shop.shopify_token,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: mutation, variables }),
          });

          const shopifyData = await shopifyResponse.json().catch(() => null);

          if (!shopifyResponse.ok || shopifyData?.errors) {
            console.error('Shopify GraphQL adjust failed:', {
              status: shopifyResponse.status,
              errors: shopifyData?.errors,
            });
            results.push({
              variantId: item.variantId,
              success: false,
              error: `Shopify sync failed: ${shopifyResponse.status} ${JSON.stringify(shopifyData?.errors ?? {})}`,
            });
            continue;
          }

          const userErrors = shopifyData?.data?.inventoryAdjustQuantities?.userErrors ?? [];
          if (userErrors.length > 0) {
            console.error('Shopify userErrors:', userErrors);
            results.push({
              variantId: item.variantId,
              success: false,
              error: `Shopify: ${userErrors.map((e: { message: string }) => e.message).join(' / ')}`,
            });
            continue;
          }
        }

        const newSourceQty = sourceQty - item.quantity;
        const { error: srcUpdateError } = await supabase
          .from('inventory_levels')
          .upsert(
            {
              variant_id: resolvedVariantId,
              location_id: sourceLocationShopifyId,
              quantity: newSourceQty,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'variant_id,location_id' },
          );
        if (srcUpdateError) {
          console.error('inventory_levels source upsert failed:', srcUpdateError);
        }

        const { data: destLevel } = await supabase
          .from('inventory_levels')
          .select('quantity')
          .eq('variant_id', resolvedVariantId)
          .eq('location_id', destLocationShopifyId)
          .maybeSingle();
        const newDestQty = (destLevel?.quantity ?? 0) + item.quantity;
        const { error: destUpdateError } = await supabase
          .from('inventory_levels')
          .upsert(
            {
              variant_id: resolvedVariantId,
              location_id: destLocationShopifyId,
              quantity: newDestQty,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'variant_id,location_id' },
          );
        if (destUpdateError) {
          console.error('inventory_levels dest upsert failed:', destUpdateError);
        }

        await upsertDailyMovement(shopId, sourceLocationUuid, resolvedVariantId, item, -item.quantity, today);
        await upsertDailyMovement(shopId, destLocationUuid, resolvedVariantId, item, item.quantity, today);

        results.push({ variantId: item.variantId, success: true });
      } catch (itemError) {
        console.error('Transfer item error:', itemError);
        results.push({ variantId: item.variantId, success: false, error: 'Processing error' });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const allSuccess = successCount === items.length;

    return NextResponse.json({
      success: allSuccess,
      message: `${successCount}/${items.length} variante(s) transférée(s)`,
      results,
    });
  } catch (error) {
    console.error('POST /api/inventory/transfer:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function upsertDailyMovement(
  shopId: string,
  locationUuid: string | null,
  variantId: string,
  item: TransferItem,
  delta: number,
  movedOn: string,
) {
  let existingQuery = supabase
    .from('stock_movements')
    .select('id, quantity')
    .eq('shop_id', shopId)
    .eq('variant_id', variantId)
    .eq('moved_on', movedOn);

  if (locationUuid) {
    existingQuery = existingQuery.eq('location_id', locationUuid);
  } else {
    existingQuery = existingQuery.is('location_id', null);
  }

  const { data: existing } = await existingQuery.maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('stock_movements')
      .update({ quantity: existing.quantity + delta })
      .eq('id', existing.id);
    if (error) console.error('stock_movements update failed:', error);
  } else {
    const { error } = await supabase.from('stock_movements').insert({
      shop_id: shopId,
      location_id: locationUuid,
      variant_id: variantId,
      product_title: item.productTitle,
      variant_title: item.variantTitle ?? null,
      quantity: delta,
      moved_on: movedOn,
    });
    if (error) console.error('stock_movements insert failed:', error);
  }
}
