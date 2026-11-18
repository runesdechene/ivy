import { NextRequest, NextResponse } from 'next/server';
import { autoriser } from '@/lib/mockups/serveur';
import { createServerClient } from '@/supabase/client';
import { fetchOrdersApiAction } from '@/actions/fetch-orders-api-action';

export async function POST(request: NextRequest) {
  try {
    const { shopId } = await request.json();

    if (!shopId) {
      return NextResponse.json(
        { error: 'Shop ID is required' },
        { status: 400 }
      );
    }
    const acces = await autoriser(request, shopId); // la session doit appartenir à cette boutique
    if (!acces.ok) return acces.reponse;

    const supabase = createServerClient();

    // Récupérer les informations de la boutique pour les credentials Shopify
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('*')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      return NextResponse.json(
        { error: 'Shop not found' },
        { status: 404 }
      );
    }

    // Créer un enregistrement de synchronisation
    const { data: syncRecord, error: syncError } = await supabase
      .from('syncs')
      .insert({
        shop_id: shopId,
        status: 'running',
      })
      .select()
      .single();

    if (syncError) {
      console.error('Error creating sync record:', syncError);
    }

    // Récupérer les commandes depuis Shopify via l'API GraphQL
    // On passe les credentials de la boutique
    const allOrders = await fetchOrdersApiAction(shop.shopify_url, shop.shopify_token);

    // Filtrer les commandes avec les tags "no-order-pro" ou "no-ivy"
    const orders = allOrders.filter(order => 
      !order.tags?.some((tag: string) => 
        tag.toLowerCase() === 'no-order-pro' || tag.toLowerCase() === 'no-ivy'
      )
    );

    // Identifier les commandes exclues à supprimer de la base
    const excludedOrderIds = allOrders
      .filter(order => order.tags?.some((tag: string) => 
        tag.toLowerCase() === 'no-order-pro' || tag.toLowerCase() === 'no-ivy'
      ))
      .map(order => order.id);

    if (excludedOrderIds.length > 0) {
      // Supprimer les commandes exclues existantes de Supabase
      const { error: deleteError } = await supabase
        .from('orders')
        .delete()
        .eq('shop_id', shopId)
        .in('shopify_id', excludedOrderIds);

      if (deleteError) {
        console.error('Error deleting excluded orders:', deleteError);
      } else {
        console.log(`Deleted ${excludedOrderIds.length} excluded orders`);
      }
    }

    console.log(`Syncing ${orders.length} orders (filtered ${allOrders.length - orders.length} excluded)`);

    // Transformer et sauvegarder les commandes dans Supabase
    const ordersToInsert = orders.map(order => ({
      shop_id: shopId,
      shopify_id: order.id,
      name: order.name,
      order_number: order.orderNumber || order.name.replace('#', ''),
      created_at: order.createdAt,
      cancelled_at: order.cancelledAt || null,
      display_fulfillment_status: order.displayFulfillmentStatus,
      display_financial_status: order.displayFinancialStatus,
      total_price: order.totalPrice,
      total_price_currency: order.totalPriceCurrency || 'EUR',
      note: order.note || null,
      tags: order.tags || [],
      line_items: order.lineItems || [],
      synced_at: new Date().toISOString(),
    }));

    // Compter les commandes AVANT l'upsert pour savoir combien sont nouvelles
    const { count: countBefore } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shopId);

    // Upsert des commandes (insert ou update si existe déjà)
    const { error: upsertError } = await supabase
      .from('orders')
      .upsert(ordersToInsert, { onConflict: 'shop_id,shopify_id' });

    if (upsertError) {
      throw upsertError;
    }
    
    // Compter les commandes APRÈS l'upsert
    const { count: countAfter } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shopId);
    
    // Le nombre de nouvelles commandes = différence entre avant et après
    const newOrdersCount = (countAfter || 0) - (countBefore || 0);
    // Les commandes mises à jour = commandes synchronisées - nouvelles
    const updatedOrdersCount = orders.length - newOrdersCount;

    // Initialiser la progression pour chaque commande
    for (const order of orders) {
      const totalCount = order.lineItems?.reduce((sum: number, item: any) => {
        return sum + (item.isCancelled ? 0 : item.quantity);
      }, 0) || 0;

      if (totalCount > 0) {
        await supabase
          .from('order_progress')
          .upsert({
            shop_id: shopId,
            order_id: order.id,
            total_count: totalCount,
            checked_count: 0,
          }, { onConflict: 'shop_id,order_id' });
      }
    }

    // Mettre à jour le statut de la synchronisation
    if (syncRecord) {
      await supabase
        .from('syncs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          orders_count: orders.length,
        })
        .eq('id', syncRecord.id);
    }

    return NextResponse.json({ 
      success: true, 
      ordersCount: orders.length,
      newOrdersCount,
      updatedOrdersCount 
    });
  } catch (error) {
    console.error('Error syncing orders:', error);
    return NextResponse.json(
      { error: 'Failed to sync orders' },
      { status: 500 }
    );
  }
}
