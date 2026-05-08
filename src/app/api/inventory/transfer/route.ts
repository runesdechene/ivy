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
          .select('id, inventory_item_id')
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

        if (variant.inventory_item_id) {
          const adjustEndpoint = `https://${shop.shopify_url}/admin/api/2024-01/inventory_levels/adjust.json`;
          const headers = {
            'X-Shopify-Access-Token': shop.shopify_token,
            'Content-Type': 'application/json',
          };

          const sourceResponse = await fetch(adjustEndpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              location_id: sourceLocationShopifyId,
              inventory_item_id: variant.inventory_item_id,
              available_adjustment: -item.quantity,
            }),
          });

          if (!sourceResponse.ok) {
            const err = await sourceResponse.json().catch(() => ({}));
            console.error('Shopify source adjust failed:', err);
            results.push({
              variantId: item.variantId,
              success: false,
              error: `Shopify source sync failed: ${sourceResponse.status}`,
            });
            continue;
          }

          const destResponse = await fetch(adjustEndpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              location_id: destLocationShopifyId,
              inventory_item_id: variant.inventory_item_id,
              available_adjustment: item.quantity,
            }),
          });

          if (!destResponse.ok) {
            const err = await destResponse.json().catch(() => ({}));
            console.error('Shopify dest adjust failed:', err);
            results.push({
              variantId: item.variantId,
              success: false,
              error: `Shopify dest sync failed (source already adjusted): ${destResponse.status}`,
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
