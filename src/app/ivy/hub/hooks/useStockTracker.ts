'use client';

import { useState, useCallback, useMemo } from 'react';
import { StockMovement } from '../types';

interface UseStockTrackerReturn {
  movements: StockMovement[];
  addMovement: (item: Omit<StockMovement, 'quantity'>) => void;
  undoMovement: (variantId: string) => void;
  clearMovements: () => void;
  keepFailed: (failures: { variantId: string; error?: string }[]) => void;
  totalOut: number;
  totalReturn: number;
  isReturnMode: boolean;
  setReturnMode: (enabled: boolean) => void;
}

export function useStockTracker(): UseStockTrackerReturn {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [isReturnMode, setIsReturnMode] = useState(false);

  const addMovement = useCallback((item: Omit<StockMovement, 'quantity'>) => {
    setMovements(prev => {
      const existing = prev.find(m => m.variantId === item.variantId);

      if (existing) {
        return prev.map(m =>
          m.variantId === item.variantId
            // On retouche la ligne → l'erreur de la validation précédente n'a plus de sens
            ? { ...m, quantity: m.quantity + (isReturnMode ? 1 : -1), syncError: undefined }
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

  /**
   * Bascule sortie ↔ retour. Le panier suit : les lignes déjà saisies changent
   * de signe (−2 → +2) au lieu d'être à ressaisir. L'en-tête du panier annonce
   * déjà « Sorties » ou « Entrées » pour tout le panier — il est donc homogène
   * par construction.
   */
  const setReturnMode = useCallback((enabled: boolean) => {
    setIsReturnMode(enabled);
    setMovements(prev =>
      prev.map(m => {
        const flipped = enabled ? Math.abs(m.quantity) : -Math.abs(m.quantity);
        if (flipped === m.quantity) return m;
        // Le sens change → l'erreur de la validation précédente ne veut plus rien dire
        return { ...m, quantity: flipped, syncError: undefined };
      }),
    );
  }, []);

  const clearMovements = useCallback(() => {
    setMovements([]);
  }, []);

  /**
   * Après une validation partielle : ne garde au panier que les lignes qui ont
   * échoué sans rien écrire, taguées avec leur raison. Les lignes passées sont
   * retirées (les revalider les compterait deux fois).
   */
  const keepFailed = useCallback((failures: { variantId: string; error?: string }[]) => {
    const byVariant = new Map(failures.map(f => [f.variantId, f.error]));
    setMovements(prev =>
      prev
        .filter(m => byVariant.has(m.variantId))
        .map(m => ({ ...m, syncError: byVariant.get(m.variantId) ?? 'Échec de la validation' })),
    );
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
    keepFailed,
    totalOut,
    totalReturn,
    isReturnMode,
    setReturnMode,
  };
}
