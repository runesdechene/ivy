'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { CartItem, DiscountRule } from '../types';
import { evaluateDiscounts, applyDiscountsToCart } from '../lib/discountEngine';

interface UseCartReturn {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'id' | 'quantity' | 'discountPercentage' | 'discountAmount'>) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  incrementQuantity: (id: string) => void;
  decrementQuantity: (id: string) => void;
  clearCart: () => void;
  subtotal: number;
  totalDiscount: number;
  total: number;
  itemsCount: number;
  isRefund: boolean;
  discountEnabled: boolean;
  setDiscountEnabled: (enabled: boolean) => void;
  activeDiscountRule: DiscountRule | null;
  setActiveDiscountRule: (rule: DiscountRule | null) => void;
  discountRules: DiscountRule[];
  setDiscountRules: (rules: DiscountRule[]) => void;
}

export function useCart(): UseCartReturn {
  const [items, setItems] = useState<CartItem[]>([]);
  const [discountEnabled, setDiscountEnabled] = useState(true);
  const [activeDiscountRule, setActiveDiscountRule] = useState<DiscountRule | null>(null);
  const [discountRules, setDiscountRules] = useState<DiscountRule[]>([]);

  const addItem = useCallback((newItem: Omit<CartItem, 'id' | 'quantity' | 'discountPercentage' | 'discountAmount'>) => {
    setItems(prev => {
      // Check if item already exists
      const existingIndex = prev.findIndex(item => item.variantId === newItem.variantId);
      
      if (existingIndex >= 0) {
        // Increment quantity
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: updated[existingIndex].quantity + 1,
        };
        return updated;
      }
      
      // Add new item
      return [...prev, {
        ...newItem,
        id: `${newItem.variantId}-${Date.now()}`,
        quantity: 1,
        discountPercentage: 0,
        discountAmount: 0,
      }];
    });
  }, []);

  // Les actions travaillent sur variantId car les items affichés peuvent avoir des IDs différents (split par remise)
  const removeItem = useCallback((variantId: string) => {
    setItems(prev => prev.filter(item => item.variantId !== variantId));
  }, []);

  const updateQuantity = useCallback((variantId: string, quantity: number) => {
    setItems(prev => prev.map(item => 
      item.variantId === variantId ? { ...item, quantity } : item
    ));
  }, []);

  const incrementQuantity = useCallback((variantId: string) => {
    setItems(prev => prev.map(item => 
      item.variantId === variantId ? { ...item, quantity: item.quantity + 1 } : item
    ));
  }, []);

  const decrementQuantity = useCallback((variantId: string) => {
    setItems(prev => prev.map(item => 
      item.variantId === variantId ? { ...item, quantity: item.quantity - 1 } : item
    ));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  // Recalculate discounts when items or rules change
  const itemsWithDiscounts = useMemo(() => {
    if (!discountEnabled || discountRules.length === 0) {
      return items.map(item => ({
        ...item,
        discountPercentage: 0,
        discountAmount: 0,
      }));
    }
    
    const result = evaluateDiscounts(items, discountRules, discountEnabled);
    
    // Set active rule if one was applied
    if (result.appliedRules.length > 0 && !activeDiscountRule) {
      setActiveDiscountRule(result.appliedRules[0]);
    }
    
    return applyDiscountsToCart(items, result);
  }, [items, discountRules, discountEnabled]);

  const subtotal = useMemo(() => {
    return items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  }, [items]);

  const totalDiscount = useMemo(() => {
    if (!discountEnabled) return 0;
    return itemsWithDiscounts.reduce((sum, item) => sum + item.discountAmount, 0);
  }, [itemsWithDiscounts, discountEnabled]);

  const total = useMemo(() => {
    return subtotal - totalDiscount;
  }, [subtotal, totalDiscount]);

  const itemsCount = useMemo(() => {
    return items.reduce((sum, item) => sum + Math.abs(item.quantity), 0);
  }, [items]);

  const isRefund = useMemo(() => {
    return total < 0;
  }, [total]);

  return {
    items: itemsWithDiscounts,
    addItem,
    removeItem,
    updateQuantity,
    incrementQuantity,
    decrementQuantity,
    clearCart,
    subtotal,
    totalDiscount,
    total,
    itemsCount,
    isRefund,
    discountEnabled,
    setDiscountEnabled,
    activeDiscountRule,
    setActiveDiscountRule,
    discountRules,
    setDiscountRules,
  };
}
