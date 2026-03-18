'use client';

import { useState, useCallback, useMemo } from 'react';
import { StockMovement } from '../types';

interface UseStockTrackerReturn {
  movements: StockMovement[];
  addMovement: (item: Omit<StockMovement, 'quantity'>) => void;
  undoMovement: (variantId: string) => void;
  clearMovements: () => void;
  totalOut: number;
  totalReturn: number;
  isReturnMode: boolean;
  setReturnMode: (enabled: boolean) => void;
}

export function useStockTracker(): UseStockTrackerReturn {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [isReturnMode, setReturnMode] = useState(false);

  const addMovement = useCallback((item: Omit<StockMovement, 'quantity'>) => {
    setMovements(prev => {
      const existing = prev.find(m => m.variantId === item.variantId);

      if (existing) {
        return prev.map(m =>
          m.variantId === item.variantId
            ? { ...m, quantity: m.quantity + (isReturnMode ? 1 : -1) }
            : m
        );
      }

      return [...prev, {
        ...item,
        quantity: isReturnMode ? 1 : -1,
      }];
    });
  }, [isReturnMode]);

  const undoMovement = useCallback((variantId: string) => {
    setMovements(prev => {
      const existing = prev.find(m => m.variantId === variantId);
      if (!existing) return prev;

      // Si quantité est -1 ou +1, on supprime la ligne
      if (Math.abs(existing.quantity) <= 1) {
        return prev.filter(m => m.variantId !== variantId);
      }

      // Sinon on rapproche de 0
      return prev.map(m =>
        m.variantId === variantId
          ? { ...m, quantity: m.quantity + (m.quantity < 0 ? 1 : -1) }
          : m
      );
    });
  }, []);

  const clearMovements = useCallback(() => {
    setMovements([]);
  }, []);

  const totalOut = useMemo(() => {
    return movements.reduce((sum, m) => sum + (m.quantity < 0 ? Math.abs(m.quantity) : 0), 0);
  }, [movements]);

  const totalReturn = useMemo(() => {
    return movements.reduce((sum, m) => sum + (m.quantity > 0 ? m.quantity : 0), 0);
  }, [movements]);

  return {
    movements,
    addMovement,
    undoMovement,
    clearMovements,
    totalOut,
    totalReturn,
    isReturnMode,
    setReturnMode,
  };
}
