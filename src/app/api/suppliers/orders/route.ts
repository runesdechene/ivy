import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');

    if (!shopId) {
      return NextResponse.json({ error: 'Shop ID required' }, { status: 400 });
    }

    // Récupérer les commandes avec le comptage des articles
    const { data: orders, error } = await supabase
      .from('supplier_orders')
      .select(`
        *,
        items:supplier_order_items(count),
        validated_items:supplier_order_items(count)
      `)
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching orders:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Transformer les données pour inclure les comptages
    const ordersWithCounts = await Promise.all((orders || []).map(async (order) => {
      // Compter les articles
      const { count: itemsCount } = await supabase
        .from('supplier_order_items')
        .select('*', { count: 'exact', head: true })
        .eq('order_id', order.id);

      // Récupérer les articles validés (count + total)
      const { data: validatedItems } = await supabase
        .from('supplier_order_items')
        .select('line_total, is_validated')
        .eq('order_id', order.id)
        .eq('is_validated', true);

      const validatedCount = validatedItems?.length || 0;
      const validatedSubtotal = validatedItems?.reduce((sum, item) => sum + (item.line_total || 0), 0) || 0;
      const validatedTotalHt = validatedSubtotal + (order.balance_adjustment || 0);

      return {
        ...order,
        items_count: itemsCount || 0,
        validated_count: validatedCount,
        total_ht: validatedTotalHt,
      };
    }));

    return NextResponse.json({ orders: ordersWithCounts });
  } catch (error) {
    console.error('Error fetching orders:', error);
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { shopId, note } = body;

    if (!shopId) {
      return NextResponse.json({ error: 'Shop ID required' }, { status: 400 });
    }

    // Générer un numéro de commande unique
    const { count } = await supabase
      .from('supplier_orders')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shopId);

    const orderNumber = `BATCH-${String((count || 0) + 1).padStart(4, '0')}`;

    const { data: order, error } = await supabase
      .from('supplier_orders')
      .insert({
        shop_id: shopId,
        order_number: orderNumber,
        status: 'draft',
        note: note || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating order:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ order });
  } catch (error) {
    console.error('Error creating order:', error);
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, shopId, status, note, balance_adjustment, locationId, retry, skipStock } = body;

    if (!id || !shopId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const updateData: any = { updated_at: new Date().toISOString() };
    
    if (status !== undefined) {
      updateData.status = status;
      if (status === 'completed') {
        updateData.closed_at = new Date().toISOString();
      }
    }
    if (note !== undefined) updateData.note = note;
    if (balance_adjustment !== undefined) updateData.balance_adjustment = balance_adjustment;

    // Recalculer les totaux si nécessaire
    if (balance_adjustment !== undefined) {
      const { data: items } = await supabase
        .from('supplier_order_items')
        .select('line_total')
        .eq('order_id', id);

      const subtotal = items?.reduce((sum, item) => sum + (item.line_total || 0), 0) || 0;
      const totalHt = subtotal + (balance_adjustment || 0);
      const totalTtc = totalHt * 1.2;

      updateData.subtotal = subtotal;
      updateData.total_ht = totalHt;
      updateData.total_ttc = totalTtc;
    }

    // Stock operations (completed or retry) — skip if explicitly requested
    let stockResult: StockResult | null = null;
    if ((status === 'completed' && !skipStock) || retry) {
      stockResult = await addValidatedItemsToStock(id, shopId, locationId, !!retry);
    }

    let order;
    if (retry) {
      // For retry, just fetch the current order without updating fields
      const { data } = await supabase
        .from('supplier_orders')
        .select('*')
        .eq('id', id)
        .eq('shop_id', shopId)
        .single();
      order = data;
    } else {
      const { data, error } = await supabase
        .from('supplier_orders')
        .update(updateData)
        .eq('id', id)
        .eq('shop_id', shopId)
        .select()
        .single();

      if (error) {
        console.error('Error updating order:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      order = data;
    }

    return NextResponse.json({ order, ...(stockResult && { stockResult }) });
  } catch (error) {
    console.error('Error updating order:', error);
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
  }
}

// --- Types ---

interface StockResult {
  added: number;
  failed: number;
  skipped: number;
  errors: Array<{ sku: string; variant_title: string; error: string }>;
}

// --- Helpers stock ---

async function batchMarkStatus(itemIds: string[], status: 'added' | 'failed', error: string | null) {
  const updateData: Record<string, any> = {
    stock_status: status,
    stock_error: error,
  };
  if (status === 'added') {
    updateData.stock_added_at = new Date().toISOString();
    updateData.stock_error = null;
  }
  await supabase
    .from('supplier_order_items')
    .update(updateData)
    .in('id', itemIds);
}

async function createVariantOnShopify(
  shop: { shopify_url: string; shopify_token: string },
  shopifyProductId: string,
  variant: { id: string; option1: string | null; option2: string | null; option3: string | null; sku: string | null; price: number }
): Promise<{ shopifyVariantId: string; inventoryItemId: string }> {
  const variantBody: Record<string, any> = {
    inventory_management: 'shopify',
  };
  if (variant.option1) variantBody.option1 = variant.option1;
  if (variant.option2) variantBody.option2 = variant.option2;
  if (variant.option3) variantBody.option3 = variant.option3;
  if (variant.sku) variantBody.sku = variant.sku;
  if (variant.price) variantBody.price = String(variant.price);

  const response = await fetch(
    `https://${shop.shopify_url}/admin/api/2024-01/products/${shopifyProductId}/variants.json`,
    {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': shop.shopify_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ variant: variantBody }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.errors ? JSON.stringify(errorData.errors) : `HTTP ${response.status}`);
  }

  const data = await response.json();
  const created = data.variant;

  // Update local DB with Shopify IDs
  await supabase
    .from('product_variants')
    .update({
      shopify_id: String(created.id),
      inventory_item_id: String(created.inventory_item_id),
      shopify_active: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', variant.id);

  return {
    shopifyVariantId: String(created.id),
    inventoryItemId: String(created.inventory_item_id),
  };
}

// --- Fonction principale stock ---

async function addValidatedItemsToStock(
  orderId: string,
  shopId: string,
  locationId?: string,
  retryOnly?: boolean
): Promise<StockResult> {
  const result: StockResult = { added: 0, failed: 0, skipped: 0, errors: [] };

  try {
    // Count already-added items (skipped)
    const { count: alreadyAddedCount } = await supabase
      .from('supplier_order_items')
      .select('*', { count: 'exact', head: true })
      .eq('order_id', orderId)
      .eq('is_validated', true)
      .eq('stock_status', 'added');

    result.skipped = alreadyAddedCount || 0;

    // Get items to process (exclude already added)
    let query = supabase
      .from('supplier_order_items')
      .select('id, variant_id, quantity, sku, variant_title')
      .eq('order_id', orderId)
      .eq('is_validated', true);

    if (retryOnly) {
      query = query.eq('stock_status', 'failed');
    } else {
      query = query.or('stock_status.is.null,stock_status.eq.failed');
    }

    const { data: validatedItems } = await query;

    if (!validatedItems || validatedItems.length === 0) {
      return result;
    }

    // Group by variant_id
    const groups: Record<string, typeof validatedItems> = {};
    for (const item of validatedItems) {
      const key = item.variant_id || 'null';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }

    // Get shop info
    const { data: shop } = await supabase
      .from('shops')
      .select('shopify_url, shopify_token')
      .eq('id', shopId)
      .single();

    if (!shop) {
      for (const groupItems of Object.values(groups)) {
        await batchMarkStatus(groupItems.map(i => i.id), 'failed', 'Shop non trouvé');
        result.failed += groupItems.length;
        result.errors.push({ sku: groupItems[0].sku || '', variant_title: groupItems[0].variant_title || '', error: 'Shop non trouvé' });
      }
      return result;
    }

    // Determine location
    let shopifyLocationId = locationId;
    if (!shopifyLocationId) {
      const { data: locations } = await supabase
        .from('locations')
        .select('shopify_id')
        .eq('shop_id', shopId)
        .eq('active', true)
        .limit(1);
      shopifyLocationId = locations?.[0]?.shopify_id;
    }

    if (!shopifyLocationId) {
      for (const groupItems of Object.values(groups)) {
        await batchMarkStatus(groupItems.map(i => i.id), 'failed', 'Aucun emplacement trouvé');
        result.failed += groupItems.length;
        result.errors.push({ sku: groupItems[0].sku || '', variant_title: groupItems[0].variant_title || '', error: 'Aucun emplacement trouvé' });
      }
      return result;
    }

    // Process each variant group
    for (const [variantKey, groupItems] of Object.entries(groups)) {
      const totalQuantity = groupItems.reduce((sum, i) => sum + i.quantity, 0);
      const itemIds = groupItems.map(i => i.id);
      const sample = groupItems[0];

      // Case 1: variant_id is NULL (link broken by ON DELETE SET NULL)
      if (variantKey === 'null') {
        await batchMarkStatus(itemIds, 'failed', 'Lien cassé — ajouter manuellement');
        result.failed += groupItems.length;
        result.errors.push({ sku: sample.sku || '', variant_title: sample.variant_title || '', error: 'Lien cassé — ajouter manuellement' });
        continue;
      }

      // Case 2: Load variant + parent product
      const { data: variant } = await supabase
        .from('product_variants')
        .select('id, shopify_id, shopify_active, inventory_item_id, option1, option2, option3, sku, price, product_id')
        .eq('id', variantKey)
        .single();

      if (!variant) {
        await batchMarkStatus(itemIds, 'failed', 'Variante introuvable en base');
        result.failed += groupItems.length;
        result.errors.push({ sku: sample.sku || '', variant_title: sample.variant_title || '', error: 'Variante introuvable en base' });
        continue;
      }

      const { data: product } = await supabase
        .from('products')
        .select('id, shopify_id, status')
        .eq('id', variant.product_id)
        .single();

      if (!product) {
        await batchMarkStatus(itemIds, 'failed', 'Produit introuvable en base');
        result.failed += groupItems.length;
        result.errors.push({ sku: sample.sku || '', variant_title: sample.variant_title || '', error: 'Produit introuvable en base' });
        continue;
      }

      let inventoryItemId = variant.inventory_item_id;
      const isShopifyReady = variant.shopify_active && inventoryItemId;

      if (!isShopifyReady) {
        if (product.shopify_id && product.status !== 'local') {
          // Try to create variant on Shopify
          try {
            const created = await createVariantOnShopify(shop, product.shopify_id, variant);
            inventoryItemId = created.inventoryItemId;
          } catch (err: any) {
            // Shopify creation failed → force fallback to IVY-only stock
            inventoryItemId = null;
          }
        }

        // IVY-only stock (truly local OR Shopify creation failed)
        if (!inventoryItemId) {
          try {
            const { data: currentLevel } = await supabase
              .from('inventory_levels')
              .select('quantity')
              .eq('variant_id', variant.id)
              .eq('location_id', shopifyLocationId)
              .single();

            const newQuantity = (currentLevel?.quantity || 0) + totalQuantity;

            await supabase
              .from('inventory_levels')
              .upsert({
                variant_id: variant.id,
                location_id: shopifyLocationId,
                quantity: newQuantity,
                synced_at: new Date().toISOString(),
              }, { onConflict: 'variant_id,location_id' });

            await batchMarkStatus(itemIds, 'added', null);
            result.added += groupItems.length;
          } catch (err: any) {
            await batchMarkStatus(itemIds, 'failed', `Erreur stock local: ${err.message}`);
            result.failed += groupItems.length;
            result.errors.push({ sku: sample.sku || '', variant_title: sample.variant_title || '', error: `Erreur stock local: ${err.message}` });
          }
          continue;
        }
      }

      // Adjust inventory (local DB + Shopify)
      try {
        const { data: currentLevel } = await supabase
          .from('inventory_levels')
          .select('quantity')
          .eq('variant_id', variant.id)
          .eq('location_id', shopifyLocationId)
          .single();

        const newQuantity = (currentLevel?.quantity || 0) + totalQuantity;

        await supabase
          .from('inventory_levels')
          .upsert({
            variant_id: variant.id,
            location_id: shopifyLocationId,
            quantity: newQuantity,
            synced_at: new Date().toISOString(),
          }, { onConflict: 'variant_id,location_id' });

        const adjustResponse = await fetch(
          `https://${shop.shopify_url}/admin/api/2024-01/inventory_levels/adjust.json`,
          {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': shop.shopify_token,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              location_id: parseInt(shopifyLocationId),
              inventory_item_id: parseInt(inventoryItemId),
              available_adjustment: totalQuantity,
            }),
          }
        );

        if (adjustResponse.ok) {
          await batchMarkStatus(itemIds, 'added', null);
          result.added += groupItems.length;
        } else {
          const errorData = await adjustResponse.json();
          const errorMsg = typeof errorData.errors === 'string'
            ? errorData.errors
            : JSON.stringify(errorData.errors || errorData);
          await batchMarkStatus(itemIds, 'failed', `Shopify: ${errorMsg}`);
          result.failed += groupItems.length;
          result.errors.push({ sku: sample.sku || '', variant_title: sample.variant_title || '', error: `Shopify: ${errorMsg}` });
        }
      } catch (err: any) {
        await batchMarkStatus(itemIds, 'failed', `Erreur: ${err.message}`);
        result.failed += groupItems.length;
        result.errors.push({ sku: sample.sku || '', variant_title: sample.variant_title || '', error: `Erreur: ${err.message}` });
      }
    }

    return result;
  } catch (error: any) {
    console.error('Error adding items to stock:', error);
    return result;
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const shopId = searchParams.get('shopId');

    if (!id || !shopId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { error } = await supabase
      .from('supplier_orders')
      .delete()
      .eq('id', id)
      .eq('shop_id', shopId);

    if (error) {
      console.error('Error deleting order:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting order:', error);
    return NextResponse.json({ error: 'Failed to delete order' }, { status: 500 });
  }
}
