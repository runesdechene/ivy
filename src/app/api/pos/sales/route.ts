import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolve a variant ID that could be a Supabase UUID or a Shopify numeric ID
async function resolveVariantId(variantId: string): Promise<string | null> {
  if (UUID_REGEX.test(variantId)) return variantId;

  const { data } = await supabase
    .from('product_variants')
    .select('id')
    .eq('shopify_id', variantId)
    .single();

  return data?.id || null;
}

// Resolve a location ID that could be a Supabase UUID or a Shopify numeric ID
async function resolveLocationId(locationId: string): Promise<string | null> {
  if (UUID_REGEX.test(locationId)) return locationId;

  const { data } = await supabase
    .from('locations')
    .select('id')
    .eq('shopify_id', locationId)
    .single();

  return data?.id || null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      shopId,
      locationId,
      sellerId,
      customerEmail,
      customerPhone,
      discountRuleId,
      subtotal,
      discountAmount,
      totalAmount,
      itemsCount,
      isRefund,
      items,
      notes,
      createdByUserId,
    } = body;

    if (!shopId || !items || items.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Resolve location ID (could be Shopify ID)
    const resolvedLocationId = locationId ? await resolveLocationId(locationId) : null;

    // Create sale header
    const { data: sale, error: saleError } = await supabase
      .from('pos_sales')
      .insert({
        shop_id: shopId,
        location_id: resolvedLocationId,
        seller_id: sellerId || null,
        customer_email: customerEmail || null,
        customer_phone: customerPhone || null,
        discount_rule_id: discountRuleId || null,
        subtotal: subtotal,
        discount_amount: discountAmount || 0,
        total_amount: totalAmount,
        items_count: itemsCount,
        is_refund: isRefund || false,
        notes: notes || null,
        created_by_user_id: createdByUserId || null,
      })
      .select()
      .single();

    if (saleError) {
      console.error('Error creating sale:', saleError);
      return NextResponse.json(
        { error: saleError.message },
        { status: 500 }
      );
    }

    // Resolve variant IDs (could be Shopify IDs) to Supabase UUIDs
    const saleItems = [];
    for (const item of items) {
      const resolvedId = await resolveVariantId(item.variantId);
      if (!resolvedId) {
        console.error(`Variant not found for ID: ${item.variantId}`);
        await supabase.from('pos_sales').delete().eq('id', sale.id);
        return NextResponse.json(
          { error: `Variant not found: ${item.variantId}` },
          { status: 400 }
        );
      }
      saleItems.push({
        sale_id: sale.id,
        variant_id: resolvedId,
        product_title: item.productTitle,
        variant_title: item.variantTitle || null,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        discount_percentage: item.discountPercentage || 0,
        discount_amount: item.discountAmount || 0,
        total_price: item.totalPrice,
      });
    }

    const { error: itemsError } = await supabase
      .from('pos_sale_items')
      .insert(saleItems);

    if (itemsError) {
      console.error('Error creating sale items:', itemsError);
      // Rollback sale header
      await supabase.from('pos_sales').delete().eq('id', sale.id);
      return NextResponse.json(
        { error: itemsError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      saleId: sale.id,
      message: isRefund ? 'Remboursement enregistré' : 'Vente enregistrée'
    });

  } catch (error: any) {
    console.error('Error in POST /api/pos/sales:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!shopId) {
      return NextResponse.json(
        { error: 'Missing shopId' },
        { status: 400 }
      );
    }

    const { data: sales, error } = await supabase
      .from('pos_sales')
      .select(`
        *,
        seller:pos_sellers(id, name, avatar_url),
        discount_rule:pos_discount_rules(id, name),
        items:pos_sale_items(*)
      `)
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(sales);

  } catch (error) {
    console.error('Error in GET /api/pos/sales:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Adjust stock for a list of variant changes (local Supabase + Shopify)
async function adjustStock(shopId: string, locationId: string | null, changes: { variantId: string; quantity: number }[]): Promise<{ results: any[] }> {
  if (!locationId || changes.length === 0) return { results: [] };

  // Get shop for Shopify credentials
  const { data: shop } = await supabase
    .from('shops')
    .select('shopify_url, shopify_token')
    .eq('id', shopId)
    .single();

  const results: { variantId: string; success: boolean; localOk: boolean; shopifyOk: boolean; error?: string }[] = [];

  for (const change of changes) {
    if (change.quantity === 0) continue;

    const resolvedId = await resolveVariantId(change.variantId);
    if (!resolvedId) {
      results.push({ variantId: change.variantId, success: false, localOk: false, shopifyOk: false, error: 'Variant not found' });
      continue;
    }

    let localOk = false;
    let shopifyOk = false;

    // Update local inventory
    const { data: currentLevel } = await supabase
      .from('inventory_levels')
      .select('quantity')
      .eq('variant_id', resolvedId)
      .eq('location_id', locationId)
      .single();

    const newQuantity = (currentLevel?.quantity || 0) + change.quantity;

    const { error: updateError } = await supabase
      .from('inventory_levels')
      .upsert({
        variant_id: resolvedId,
        location_id: locationId,
        quantity: newQuantity,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'variant_id,location_id' });

    localOk = !updateError;
    if (updateError) console.error('Local inventory update error:', updateError);

    // Sync with Shopify
    if (shop?.shopify_url && shop?.shopify_token) {
      const { data: variant } = await supabase
        .from('product_variants')
        .select('inventory_item_id')
        .eq('id', resolvedId)
        .single();

      if (variant?.inventory_item_id) {
        // locationId is a Shopify ID (TEXT), use it directly
        try {
          const shopifyResponse = await fetch(
            `https://${shop.shopify_url}/admin/api/2024-01/inventory_levels/adjust.json`,
            {
              method: 'POST',
              headers: {
                'X-Shopify-Access-Token': shop.shopify_token,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                location_id: locationId,
                inventory_item_id: variant.inventory_item_id,
                available_adjustment: change.quantity,
              }),
            }
          );
          shopifyOk = shopifyResponse.ok;
          if (!shopifyResponse.ok) {
            const errData = await shopifyResponse.json().catch(() => ({}));
            console.error('Shopify inventory adjust error:', errData);
          }
        } catch (e) {
          console.error('Shopify sync error:', e);
        }
      }
    }

    results.push({ variantId: change.variantId, success: localOk, localOk, shopifyOk });
  }

  return { results };
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { saleId, sellerId, customerEmail, customerPhone, notes, items } = body;

    if (!saleId) {
      return NextResponse.json({ error: 'Missing saleId' }, { status: 400 });
    }

    // Get the sale with its current items and location for stock adjustment
    const { data: sale } = await supabase
      .from('pos_sales')
      .select('shop_id, location_id, is_refund')
      .eq('id', saleId)
      .single();

    // Update sale header
    const updates: Record<string, any> = {};
    if (sellerId !== undefined) updates.seller_id = sellerId || null;
    if (customerEmail !== undefined) updates.customer_email = customerEmail || null;
    if (customerPhone !== undefined) updates.customer_phone = customerPhone || null;
    if (notes !== undefined) updates.notes = notes || null;

    // If items are provided, recalculate totals
    if (items && items.length > 0) {
      const subtotal = items.reduce((sum: number, item: any) => sum + item.quantity * item.unitPrice, 0);
      const discountAmount = items.reduce((sum: number, item: any) => sum + (item.discountAmount || 0), 0);
      updates.subtotal = subtotal;
      updates.discount_amount = discountAmount;
      updates.total_amount = subtotal - discountAmount;
      updates.items_count = items.reduce((sum: number, item: any) => sum + item.quantity, 0);
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('pos_sales')
        .update(updates)
        .eq('id', saleId);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    // If items provided, compute stock diff and replace items
    let stockResults: any[] = [];
    if (items && items.length > 0 && sale) {
      // Get old items
      const { data: oldItems } = await supabase
        .from('pos_sale_items')
        .select('variant_id, quantity')
        .eq('sale_id', saleId);

      // Build old qty map (variant_id -> total quantity)
      const oldQtyMap = new Map<string, number>();
      (oldItems || []).forEach((oi: any) => {
        oldQtyMap.set(oi.variant_id, (oldQtyMap.get(oi.variant_id) || 0) + oi.quantity);
      });

      // Build new qty map
      const newQtyMap = new Map<string, number>();
      for (const item of items) {
        const resolvedId = await resolveVariantId(item.variantId);
        if (resolvedId) {
          newQtyMap.set(resolvedId, (newQtyMap.get(resolvedId) || 0) + item.quantity);
        }
      }

      // Compute diff: positive = need to add back to stock, negative = need to remove from stock
      const stockChanges: { variantId: string; quantity: number }[] = [];
      const allVariantIds = new Set([...oldQtyMap.keys(), ...newQtyMap.keys()]);
      for (const vid of allVariantIds) {
        const oldQty = oldQtyMap.get(vid) || 0;
        const newQty = newQtyMap.get(vid) || 0;
        const diff = oldQty - newQty; // positive = items removed from sale = add back to stock
        if (diff !== 0) {
          stockChanges.push({ variantId: vid, quantity: diff });
        }
      }

      // Resolve location_id: sale stores UUID, but inventory_levels uses Shopify ID
      let shopifyLocationId = sale.location_id;
      if (sale.location_id && UUID_REGEX.test(sale.location_id)) {
        const { data: loc } = await supabase.from('locations').select('shopify_id').eq('id', sale.location_id).single();
        shopifyLocationId = loc?.shopify_id || sale.location_id;
      }

      if (stockChanges.length > 0) {
        const result = await adjustStock(sale.shop_id, shopifyLocationId, stockChanges);
        stockResults = result.results;
      }

      // Delete existing items
      await supabase.from('pos_sale_items').delete().eq('sale_id', saleId);

      // Insert new items with resolved variant IDs
      const saleItems = [];
      for (const item of items) {
        const resolvedId = await resolveVariantId(item.variantId);
        saleItems.push({
          sale_id: saleId,
          variant_id: resolvedId || item.variantId,
          product_title: item.productTitle,
          variant_title: item.variantTitle || null,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          discount_percentage: item.discountPercentage || 0,
          discount_amount: item.discountAmount || 0,
          total_price: item.totalPrice,
        });
      }

      const { error: itemsError } = await supabase
        .from('pos_sale_items')
        .insert(saleItems);

      if (itemsError) {
        return NextResponse.json({ error: itemsError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, stockAdjustments: stockResults });
  } catch (error) {
    console.error('Error in PUT /api/pos/sales:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const saleId = searchParams.get('saleId');

    if (!saleId) {
      return NextResponse.json({ error: 'Missing saleId' }, { status: 400 });
    }

    // Get sale info + items before deleting
    const { data: sale } = await supabase
      .from('pos_sales')
      .select('shop_id, location_id, is_refund')
      .eq('id', saleId)
      .single();

    const { data: saleItems } = await supabase
      .from('pos_sale_items')
      .select('variant_id, quantity')
      .eq('sale_id', saleId);

    // Restore stock (add back sold quantities)
    let stockResults: any[] = [];
    if (sale && saleItems && saleItems.length > 0) {
      // Resolve location_id: sale stores UUID, but inventory_levels uses Shopify ID
      let shopifyLocationId = sale.location_id;
      if (sale.location_id && UUID_REGEX.test(sale.location_id)) {
        const { data: loc } = await supabase.from('locations').select('shopify_id').eq('id', sale.location_id).single();
        shopifyLocationId = loc?.shopify_id || sale.location_id;
      }

      const stockChanges = saleItems.map((item: any) => ({
        variantId: item.variant_id,
        quantity: item.quantity, // Add back (positive = restore stock)
      }));

      const result = await adjustStock(sale.shop_id, shopifyLocationId, stockChanges);
      stockResults = result.results;
    }

    // Delete items then sale
    await supabase.from('pos_sale_items').delete().eq('sale_id', saleId);

    const { error } = await supabase
      .from('pos_sales')
      .delete()
      .eq('id', saleId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, stockAdjustments: stockResults });
  } catch (error) {
    console.error('Error in DELETE /api/pos/sales:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
