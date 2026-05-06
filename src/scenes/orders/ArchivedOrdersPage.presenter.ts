'use client';

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/supabase/client';
import { useShop } from '@/context/ShopContext';
import type { ShopifyOrder } from '@/types/shopify';

const ORDERS_PER_PAGE = 30;

export function useArchivedOrdersPagePresenter() {
  const [isReversed, setIsReversed] = useState(false);
  const [orders, setOrders] = useState<ShopifyOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<ShopifyOrder | undefined>(undefined);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const { currentShop } = useShop();

  useEffect(() => {
    if (!currentShop) {
      setOrders([]);
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

    loadOrders();

    const channel = supabase
      .channel('archived-orders-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `shop_id=eq.${currentShop.id}` },
        () => loadOrders()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentShop]);

  const archivedOrders = useMemo(() => {
    return orders.filter(order => {
      if (order.displayFinancialStatus?.toLowerCase() === 'refunded') {
        return false;
      }

      const status = order.displayFulfillmentStatus?.toLowerCase();
      if (status !== 'fulfilled') {
        return false;
      }

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

  const sortedArchivedOrders = useMemo(() => {
    return isReversed ? [...archivedOrders].reverse() : archivedOrders;
  }, [archivedOrders, isReversed]);

  const totalPages = Math.ceil(sortedArchivedOrders.length / ORDERS_PER_PAGE);

  const paginatedOrders = useMemo(() => {
    const startIndex = (currentPage - 1) * ORDERS_PER_PAGE;
    const endIndex = startIndex + ORDERS_PER_PAGE;
    return sortedArchivedOrders.slice(startIndex, endIndex);
  }, [sortedArchivedOrders, currentPage]);

  const toggleOrder = () => {
    setIsReversed(prev => !prev);
    setCurrentPage(1);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return {
    archivedOrders: paginatedOrders,
    totalOrders: sortedArchivedOrders.length,
    currentPage,
    totalPages,
    isReversed,
    toggleOrder,
    handlePageChange,
    selectedOrder,
    isDrawerOpen,
    onSelectOrder,
    onCloseDrawer,
    isLoading,
  };
}
