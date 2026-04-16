import { useState, useEffect } from 'react';
import { supabase } from '@/supabase/client';
import { useShop } from '@/context/ShopContext';
import type { ShopifyOrder } from '@/types/shopify';

interface UseOrdersOptions {
  excludeTags?: string[];
  includeTags?: string[];
  excludeOrderNumbers?: string[];
  includeCancelled?: boolean;
}

export function useOrders(options: UseOrdersOptions = {}) {
  const [orders, setOrders] = useState<ShopifyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { currentShop } = useShop();

  const { excludeTags = [], includeTags = [], excludeOrderNumbers = [], includeCancelled = false } = options;

  useEffect(() => {
    if (!currentShop) {
      setOrders([]);
      setLoading(false);
      return;
    }

    const loadOrders = async () => {
      setLoading(true);
      try {
        const { data, error: queryError } = await supabase
          .from('orders')
          .select('*')
          .eq('shop_id', currentShop.id)
          .order('created_at', { ascending: false });

        if (queryError) throw queryError;

        // Transformer les données Supabase en format ShopifyOrder
        let transformedOrders: ShopifyOrder[] = (data || []).map(order => ({
          id: order.shopify_id,
          name: order.name,
          orderNumber: order.order_number,
          createdAt: order.created_at,
          cancelledAt: order.cancelled_at,
          displayFulfillmentStatus: order.display_fulfillment_status,
          displayFinancialStatus: order.display_financial_status,
          totalPrice: order.total_price,
          totalPriceCurrency: order.total_price_currency || 'EUR',
          note: order.note,
          tags: order.tags || [],
          lineItems: order.line_items || [],
        }));

        // Exclure les commandes annulées
        if (!includeCancelled) {
          transformedOrders = transformedOrders.filter(order => !order.cancelledAt);
        }

        // Filtrer par tags exclus
        if (excludeTags.length > 0) {
          transformedOrders = transformedOrders.filter(order => 
            !excludeTags.some(tag => order.tags?.includes(tag))
          );
        }

        // Filtrer par tags inclus
        if (includeTags.length > 0) {
          transformedOrders = transformedOrders.filter(order => 
            includeTags.some(tag => order.tags?.includes(tag))
          );
        }

        // Exclure certains numéros de commande
        if (excludeOrderNumbers.length > 0) {
          transformedOrders = transformedOrders.filter(order => 
            !excludeOrderNumbers.includes(order.name)
          );
        }

        setOrders(transformedOrders);
        setError(null);
      } catch (err) {
        console.error('Error loading orders:', err);
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    };

    loadOrders();

    // Écouter les changements en temps réel
    const channel = supabase
      .channel('orders-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `shop_id=eq.${currentShop.id}` },
        () => loadOrders()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentShop, excludeTags.join(','), includeTags.join(','), excludeOrderNumbers.join(','), includeCancelled]);

  return { orders, loading, error, refetch: () => {} };
}

// Hook pour les commandes clients (sans tag "batch")
export function useClientOrders() {
  return useOrders({
    excludeTags: ['batch', 'no-order-pro', 'precommande'],
    excludeOrderNumbers: ['#1465'],
  });
}

// Hook pour les commandes batch (avec tag "batch")
export function useBatchOrders() {
  return useOrders({
    includeTags: ['batch'],
    excludeTags: ['no-order-pro'],
  });
}
