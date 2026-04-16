'use client';

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/supabase/client';
import { useShop } from '@/context/ShopContext';
import type { ShopifyOrder } from '@/types/shopify';

export interface OrderProgress {
  checkedCount: number;
  totalCount: number;
}

export function useDetailedOrdersPagePresenter() {
  const [isReversed, setIsReversed] = useState(false);
  const [orders, setOrders] = useState<ShopifyOrder[]>([]);
  const [progressByOrder, setProgressByOrder] = useState<Record<string, OrderProgress>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<ShopifyOrder | undefined>(undefined);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const { currentShop } = useShop();

  useEffect(() => {
    if (!currentShop) {
      setOrders([]);
      setProgressByOrder({});
      setIsLoading(false);
      return;
    }

    const loadOrders = async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('shop_id', currentShop.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching orders:', error);
        setIsLoading(false);
        return;
      }

      const ordersData: ShopifyOrder[] = (data || []).map(order => ({
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

      setOrders(ordersData);
      setIsLoading(false);
    };

    const loadProgress = async () => {
      const { data, error } = await supabase
        .from('order_progress')
        .select('order_id, checked_count, total_count')
        .eq('shop_id', currentShop.id);

      if (error) {
        console.error('Error fetching progress:', error);
        return;
      }

      const map: Record<string, OrderProgress> = {};
      (data || []).forEach((row: any) => {
        map[row.order_id] = {
          checkedCount: row.checked_count || 0,
          totalCount: row.total_count || 0,
        };
      });
      setProgressByOrder(map);
    };

    loadOrders();
    loadProgress();

    // Écouter les changements en temps réel (orders)
    const channelOrders = supabase
      .channel('orders-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `shop_id=eq.${currentShop.id}` },
        () => loadOrders()
      )
      .subscribe();

    // Écouter les changements sur order_progress
    const channelProgress = supabase
      .channel('order-progress-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_progress', filter: `shop_id=eq.${currentShop.id}` },
        () => loadProgress()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channelOrders);
      supabase.removeChannel(channelProgress);
    };
  }, [currentShop]);

  const pendingOrders = useMemo(() => {
    return orders.filter(order => {
      // Ne pas inclure les commandes annulées
      if (order.cancelledAt) {
        return false;
      }

      // Ne pas inclure les commandes remboursées
      if (order.displayFinancialStatus?.toLowerCase() === 'refunded') {
        return false;
      }

      // Ne pas inclure les commandes expédiées
      const status = order.displayFulfillmentStatus?.toLowerCase();
      if (status === 'fulfilled') {
        return false;
      }

      // Ne pas inclure les commandes avec une balise contenant 'batch'
      if (order.tags?.some(tag => tag.toLowerCase().includes('batch'))) {
        return false;
      }

      return true;
    });
  }, [orders]);

  const onSelectOrder = (id: string) => {
    const order = orders.find(o => o.id === id);
    setSelectedOrder(order);
    setIsDrawerOpen(true);
  };

  const onCloseDrawer = () => {
    setIsDrawerOpen(false);
    setSelectedOrder(undefined);
  };

  const orderStats = useMemo(() => {
    const now = new Date();
    const stats = {
      old: 0, // >14 jours
      medium: 0, // 7-14 jours
      recent: 0 // <7 jours
    };

    pendingOrders.forEach(order => {
      const orderDate = new Date(order.createdAt);
      const daysDiff = Math.floor((now.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysDiff > 14) {
        stats.old++;
      } else if (daysDiff > 7) {
        stats.medium++;
      } else {
        stats.recent++;
      }
    });

    return stats;
  }, [pendingOrders]);

  const sortedPendingOrders = useMemo(() => {
    return isReversed ? [...pendingOrders].reverse() : pendingOrders;
  }, [pendingOrders, isReversed]);

  const toggleOrder = () => setIsReversed(prev => !prev);

  return {
    pendingOrders: sortedPendingOrders,
    progressByOrder,
    orderStats,
    isReversed,
    toggleOrder,
    selectedOrder,
    isDrawerOpen,
    onSelectOrder,
    onCloseDrawer,
    isLoading,
  };
}
