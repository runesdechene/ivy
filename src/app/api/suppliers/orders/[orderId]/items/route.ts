import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const body = await request.json();
    const { shopId, items } = body;
    const { orderId } = await params;

    if (!shopId || !orderId || !items || !Array.isArray(items)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Récupérer les variantes avec leur coût et shopify_id
    const variantIds = items.map((item: any) => item.variant_id).filter(Boolean);
    const { data: variants } = await supabase
      .from('product_variants')
      .select('id, cost, shopify_id')
      .in('id', variantIds);

    const variantCostMap: Record<string, number> = {};
    const variantShopifyIdMap: Record<string, string> = {};
    variants?.forEach((v: any) => {
      variantCostMap[v.id] = v.cost || 0;
      variantShopifyIdMap[v.id] = v.shopify_id;
    });

    // Récupérer les métachamps configurés pour ce shop
    const { data: metafieldConfigs } = await supabase
      .from('metafield_config')
      .select('namespace, key, display_name')
      .eq('shop_id', shopId)
      .eq('is_active', true);

    // Récupérer les métachamps des variantes via GraphQL si configurés
    let variantMetafieldsMap: Record<string, Record<string, string>> = {};
    if (metafieldConfigs && metafieldConfigs.length > 0) {
      variantMetafieldsMap = await fetchVariantMetafields(
        shopId, 
        Object.values(variantShopifyIdMap), 
        metafieldConfigs
      );
    }

    // Préparer les articles à insérer (UNE LIGNE PAR UNITÉ pour suivi individuel)
    const itemsToInsert: any[] = [];
    for (const item of items) {
      const unitPrice = variantCostMap[item.variant_id] || 0;
      const quantity = item.quantity || 1;
      const shopifyId = variantShopifyIdMap[item.variant_id];
      const metafields = shopifyId ? (variantMetafieldsMap[shopifyId] || {}) : {};
      
      // Créer une ligne par unité
      for (let i = 0; i < quantity; i++) {
        itemsToInsert.push({
          order_id: orderId,
          variant_id: item.variant_id,
          product_title: item.product_title,
          variant_title: item.variant_title,
          sku: item.sku,
          quantity: 1, // Toujours 1 par ligne
          unit_price: unitPrice,
          line_total: unitPrice, // = unitPrice * 1
          metafields: metafields,
        });
      }
    }

    const { data: insertedItems, error } = await supabase
      .from('supplier_order_items')
      .insert(itemsToInsert)
      .select();

    if (error) {
      console.error('Error inserting items:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Mettre à jour les totaux de la commande
    await updateOrderTotals(orderId, shopId);

    // Passer la commande en "in_progress" si elle était en "draft"
    await supabase
      .from('supplier_orders')
      .update({ status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .eq('status', 'draft');

    return NextResponse.json({ items: insertedItems });
  } catch (error) {
    console.error('Error adding items:', error);
    return NextResponse.json({ error: 'Failed to add items' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const body = await request.json();
    const { shopId, itemId, is_validated, is_printed, quantity, unit_price, action } = body;
    const { orderId } = await params;

    // Action spéciale : recalculer tous les prix basés sur les coûts actuels
    if (action === 'recalculate_prices') {
      if (!shopId || !orderId) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      // Récupérer tous les articles de la commande
      const { data: orderItems } = await supabase
        .from('supplier_order_items')
        .select('id, variant_id, quantity')
        .eq('order_id', orderId);

      if (!orderItems || orderItems.length === 0) {
        return NextResponse.json({ message: 'No items to update' });
      }

      // Récupérer les coûts des variantes
      const variantIds = orderItems.map(i => i.variant_id).filter(Boolean);
      const { data: variants } = await supabase
        .from('product_variants')
        .select('id, cost')
        .in('id', variantIds);

      const costMap: Record<string, number> = {};
      variants?.forEach(v => {
        costMap[v.id] = v.cost || 0;
      });

      // Mettre à jour chaque article
      let updatedCount = 0;
      for (const item of orderItems) {
        const cost = item.variant_id ? (costMap[item.variant_id] || 0) : 0;
        const lineTotal = cost * item.quantity;

        await supabase
          .from('supplier_order_items')
          .update({ 
            unit_price: cost, 
            line_total: lineTotal,
            updated_at: new Date().toISOString()
          })
          .eq('id', item.id);

        updatedCount++;
      }

      // Mettre à jour les totaux de la commande
      await updateOrderTotals(orderId, shopId);

      return NextResponse.json({ 
        message: `${updatedCount} articles mis à jour`,
        updatedCount 
      });
    }

    // Action spéciale : rafraîchir les métachamps de tous les articles
    if (action === 'refresh_metafields') {
      if (!shopId || !orderId) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      // Récupérer tous les articles de la commande avec leur variant_id
      const { data: orderItems } = await supabase
        .from('supplier_order_items')
        .select('id, variant_id')
        .eq('order_id', orderId);

      if (!orderItems || orderItems.length === 0) {
        return NextResponse.json({ message: 'No items to update' });
      }

      // Récupérer les shopify_ids des variantes
      const variantIds = [...new Set(orderItems.map(i => i.variant_id).filter(Boolean))];
      const { data: variants } = await supabase
        .from('product_variants')
        .select('id, shopify_id')
        .in('id', variantIds);

      const variantShopifyIdMap: Record<string, string> = {};
      variants?.forEach(v => {
        variantShopifyIdMap[v.id] = v.shopify_id;
      });

      // Récupérer les métachamps configurés
      const { data: metafieldConfigs } = await supabase
        .from('metafield_config')
        .select('namespace, key, display_name')
        .eq('shop_id', shopId)
        .eq('is_active', true);

      if (!metafieldConfigs || metafieldConfigs.length === 0) {
        return NextResponse.json({ message: 'Aucun métachamp configuré' });
      }

      // Récupérer les métachamps via GraphQL
      const variantMetafieldsMap = await fetchVariantMetafields(
        shopId,
        Object.values(variantShopifyIdMap),
        metafieldConfigs
      );

      // Mettre à jour chaque article avec ses métachamps
      let updatedCount = 0;
      for (const item of orderItems) {
        if (!item.variant_id) continue;
        
        const shopifyId = variantShopifyIdMap[item.variant_id];
        const metafields = shopifyId ? (variantMetafieldsMap[shopifyId] || {}) : {};

        await supabase
          .from('supplier_order_items')
          .update({ 
            metafields,
            updated_at: new Date().toISOString()
          })
          .eq('id', item.id);

        updatedCount++;
      }

      // Compter combien ont des métachamps non-vides
      const withMetafields = Object.values(variantMetafieldsMap).filter(m => Object.keys(m).length > 0).length;
      
      return NextResponse.json({ 
        message: `${updatedCount} articles traités, ${withMetafields} variantes avec métachamps`,
        updatedCount,
      });
    }

    if (!shopId || !orderId || !itemId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const updateData: any = { updated_at: new Date().toISOString() };
    
    if (is_validated !== undefined) {
      updateData.is_validated = is_validated;
      updateData.validated_at = is_validated ? new Date().toISOString() : null;
    }
    
    if (is_printed !== undefined) {
      updateData.is_printed = is_printed;
      updateData.printed_at = is_printed ? new Date().toISOString() : null;
    }
    
    if (quantity !== undefined) {
      updateData.quantity = quantity;
      // Recalculer le total de la ligne
      const { data: item } = await supabase
        .from('supplier_order_items')
        .select('unit_price')
        .eq('id', itemId)
        .single();
      
      if (item) {
        updateData.line_total = (unit_price || item.unit_price) * quantity;
      }
    }
    
    if (unit_price !== undefined) {
      updateData.unit_price = unit_price;
      // Recalculer le total de la ligne
      const { data: item } = await supabase
        .from('supplier_order_items')
        .select('quantity')
        .eq('id', itemId)
        .single();
      
      if (item) {
        updateData.line_total = unit_price * (quantity || item.quantity);
      }
    }

    const { data: updatedItem, error } = await supabase
      .from('supplier_order_items')
      .update(updateData)
      .eq('id', itemId)
      .select()
      .single();

    if (error) {
      console.error('Error updating item:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Mettre à jour les totaux de la commande si nécessaire
    // Inclure is_validated car le total ne compte que les items cochés
    if (quantity !== undefined || unit_price !== undefined || is_validated !== undefined) {
      await updateOrderTotals(orderId, shopId);
    }

    return NextResponse.json({ item: updatedItem });
  } catch (error) {
    console.error('Error updating item:', error);
    return NextResponse.json({ error: 'Failed to update item' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get('itemId');
    const shopId = searchParams.get('shopId');
    const { orderId } = await params;

    if (!shopId || !orderId || !itemId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { error } = await supabase
      .from('supplier_order_items')
      .delete()
      .eq('id', itemId);

    if (error) {
      console.error('Error deleting item:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Mettre à jour les totaux de la commande
    await updateOrderTotals(orderId, shopId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting item:', error);
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 });
  }
}

async function updateOrderTotals(orderId: string, shopId: string) {
  // Calculer le sous-total (UNIQUEMENT les items validés/cochés)
  const { data: items } = await supabase
    .from('supplier_order_items')
    .select('line_total, is_validated')
    .eq('order_id', orderId);

  // Ne compter que les items validés dans le total
  const subtotal = items?.filter(item => item.is_validated).reduce((sum, item) => sum + (item.line_total || 0), 0) || 0;

  // Récupérer la balance actuelle
  const { data: order } = await supabase
    .from('supplier_orders')
    .select('balance_adjustment')
    .eq('id', orderId)
    .single();

  const balanceAdjustment = order?.balance_adjustment || 0;
  const totalHt = subtotal + balanceAdjustment;
  const totalTtc = totalHt * 1.2;

  // Mettre à jour la commande
  await supabase
    .from('supplier_orders')
    .update({
      subtotal,
      total_ht: totalHt,
      total_ttc: totalTtc,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('shop_id', shopId);
}

// Récupérer les métachamps des variantes via GraphQL
async function fetchVariantMetafields(
  shopId: string,
  variantShopifyIds: string[],
  metafieldConfigs: Array<{ namespace: string; key: string; display_name: string }>
): Promise<Record<string, Record<string, string>>> {
  try {
    // Récupérer les infos du shop
    const { data: shop } = await supabase
      .from('shops')
      .select('shopify_url, shopify_token')
      .eq('id', shopId)
      .single();

    if (!shop) return {};

    // Construire les GIDs des variantes
    const variantGids = variantShopifyIds.map(id => `gid://shopify/ProductVariant/${id}`);

    // Requête GraphQL pour récupérer tous les métachamps
    const allMetafieldsQuery = `
      query GetVariantMetafields($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            sku
            metafields(first: 50) {
              edges {
                node {
                  namespace
                  key
                  value
                }
              }
            }
          }
        }
      }
    `;

    const response = await fetch(
      `https://${shop.shopify_url}/admin/api/2024-01/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': shop.shopify_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: allMetafieldsQuery,
          variables: { ids: variantGids },
        }),
      }
    );

    if (!response.ok) {
      console.error('GraphQL request failed:', response.status);
      return {};
    }

    const data = await response.json();
    
    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      return {};
    }

    // Construire le map des métachamps par variant shopify_id
    const result: Record<string, Record<string, string>> = {};
    
    // Créer un map des métachamps configurés pour filtrage rapide (insensible à la casse)
    const configuredKeysMap = new Map<string, { namespace: string; key: string; display_name: string }>();
    for (const c of metafieldConfigs) {
      configuredKeysMap.set(`${c.namespace}.${c.key}`.toLowerCase(), c);
    }
    
    for (const node of data.data?.nodes || []) {
      if (!node?.id) continue;
      
      // Extraire le shopify_id du GID
      const shopifyId = node.id.replace('gid://shopify/ProductVariant/', '');
      
      result[shopifyId] = {};
      
      // Parcourir les edges de metafields
      for (const edge of node.metafields?.edges || []) {
        const mf = edge.node;
        if (mf && mf.value) {
          const fullKeyLower = `${mf.namespace}.${mf.key}`.toLowerCase();
          // Ne garder que les métachamps configurés (comparaison insensible à la casse)
          const config = configuredKeysMap.get(fullKeyLower);
          if (config) {
            const displayName = config.display_name || `${mf.namespace}.${mf.key}`;
            result[shopifyId][displayName] = mf.value;
          }
        }
      }
    }

    return result;
  } catch (error) {
    console.error('Error fetching variant metafields:', error);
    return {};
  }
}
