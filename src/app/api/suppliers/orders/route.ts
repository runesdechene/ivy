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
    const { id, shopId, status, note, balance_adjustment, locationId } = body;

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

    // Si on passe en "completed", ajouter les articles validés au stock
    if (status === 'completed') {
      await addValidatedItemsToStock(id, shopId, locationId);
    }

    const { data: order, error } = await supabase
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

    return NextResponse.json({ order });
  } catch (error) {
    console.error('Error updating order:', error);
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
  }
}

// Ajouter les articles validés au stock local et synchroniser vers Shopify
async function addValidatedItemsToStock(orderId: string, shopId: string, locationId?: string) {
  try {
    // Récupérer les articles validés de la commande
    const { data: validatedItems } = await supabase
      .from('supplier_order_items')
      .select('variant_id, quantity')
      .eq('order_id', orderId)
      .eq('is_validated', true);

    if (!validatedItems || validatedItems.length === 0) {
      console.log('No validated items to add to stock');
      return;
    }

    // Grouper par variant_id et compter les quantités
    const variantQuantities: Record<string, number> = {};
    validatedItems.forEach(item => {
      if (item.variant_id) {
        variantQuantities[item.variant_id] = (variantQuantities[item.variant_id] || 0) + item.quantity;
      }
    });

    console.log('Adding to stock:', variantQuantities);

    // Récupérer les infos du shop pour l'API Shopify
    const { data: shop } = await supabase
      .from('shops')
      .select('shopify_url, shopify_token')
      .eq('id', shopId)
      .single();

    if (!shop) {
      console.error('Shop not found');
      return;
    }

    // Récupérer les inventory_item_ids des variantes
    const variantIds = Object.keys(variantQuantities);
    const { data: variants } = await supabase
      .from('product_variants')
      .select('id, inventory_item_id')
      .in('id', variantIds);

    if (!variants) {
      console.error('Variants not found');
      return;
    }

    // Déterminer le location_id à utiliser
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
      console.error('No location found for stock update');
      return;
    }

    // Mettre à jour le stock local et Shopify pour chaque variante
    for (const variant of variants) {
      const quantityToAdd = variantQuantities[variant.id];
      
      if (!variant.inventory_item_id || !quantityToAdd) continue;

      // 1. Mettre à jour le stock local dans Supabase
      const { data: currentLevel } = await supabase
        .from('inventory_levels')
        .select('quantity')
        .eq('variant_id', variant.id)
        .eq('location_id', shopifyLocationId)
        .single();

      const newQuantity = (currentLevel?.quantity || 0) + quantityToAdd;

      await supabase
        .from('inventory_levels')
        .upsert({
          variant_id: variant.id,
          location_id: shopifyLocationId,
          quantity: newQuantity,
          synced_at: new Date().toISOString(),
        }, { onConflict: 'variant_id,location_id' });

      // 2. Synchroniser vers Shopify via l'API
      try {
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
              inventory_item_id: parseInt(variant.inventory_item_id),
              available_adjustment: quantityToAdd,
            }),
          }
        );

        if (adjustResponse.ok) {
          console.log(`Stock updated for variant ${variant.id}: +${quantityToAdd}`);
        } else {
          const errorData = await adjustResponse.json();
          console.error(`Failed to update Shopify stock for variant ${variant.id}:`, errorData);
        }
      } catch (shopifyError) {
        console.error(`Shopify API error for variant ${variant.id}:`, shopifyError);
      }
    }

    console.log('Stock update completed');
  } catch (error) {
    console.error('Error adding items to stock:', error);
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
