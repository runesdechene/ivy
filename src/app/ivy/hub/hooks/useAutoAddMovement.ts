'use client';

import { useEffect } from 'react';
import { StockMovement, VariantOption, SelectedProduct } from '../types';
import { ColumnKey } from './useProductSelection';

/**
 * Auto-ajoute un mouvement de stock dès qu'une variante est entièrement
 * sélectionnée. Extrait de SelectionZone pour être partagé avec le layout
 * mobile (HubMobile) — garantit un comportement identique desktop/mobile.
 *
 * Dépendance volontairement limitée à `selectedVariant` : l'effet ne doit se
 * déclencher qu'au moment où la variante devient complète (comportement
 * historique de SelectionZone).
 */
export function useAutoAddMovement(
  selectedVariant: VariantOption | null,
  selectedProduct: SelectedProduct | null,
  columnOrder: ColumnKey[],
  selections: Record<ColumnKey, string | null>,
  onAddMovement: (item: Omit<StockMovement, 'quantity'>) => void,
): void {
  useEffect(() => {
    if (selectedVariant && selectedProduct) {
      const optionParts: string[] = [];
      for (const key of columnOrder) {
        if (key.startsWith('opt') && selections[key]) {
          optionParts.push(selections[key]!);
        }
      }

      onAddMovement({
        variantId: selectedVariant.variantId!,
        productId: selectedProduct.id,
        productTitle: selectedProduct.title,
        productType: selectedProduct.productType,
        variantTitle: optionParts.join(' / '),
        options: {},
        stock: selectedVariant.stock,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariant]);
}
