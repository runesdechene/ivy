'use client';

import { useState, useEffect, useCallback } from 'react';
import { notifications } from '@mantine/notifications';
import { Checkbox, Group } from '@mantine/core';
import { useShop } from '@/context/ShopContext';
import { useLocation } from '@/context/LocationContext';
import { loadColorMappingsFromSupabase } from '@/utils/color-transformer';
import { SelectionZone } from './components/SelectionZone';
import { StockZone } from './components/StockZone';
import { useStockTracker } from './hooks/useStockTracker';
import { useProductSelection, ColumnKey } from './hooks/useProductSelection';
import { StockMovement } from './types';
import styles from './caisse.module.scss';

export default function CaissePage() {
  const { currentShop } = useShop();
  const { currentLocation } = useLocation();
  const [processing, setProcessing] = useState(false);

  const tracker = useStockTracker();
  const ps = useProductSelection(currentShop?.id, currentLocation?.id);

  // Hidden columns (persisted in localStorage)
  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnKey>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('hub_hiddenColumns');
      if (saved) {
        try { return new Set(JSON.parse(saved)); } catch { /* ignore */ }
      }
    }
    return new Set();
  });

  const toggleColumn = useCallback((key: ColumnKey) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      localStorage.setItem('hub_hiddenColumns', JSON.stringify([...next]));
      return next;
    });
  }, []);

  // Visible columns = active columns minus hidden, UNLESS a selected product needs them
  const visibleColumns = ps.activeColumns.filter(key => {
    // Type and Product always visible
    if (key === 'type' || key === 'product') return true;
    // If not hidden, show
    if (!hiddenColumns.has(key)) return true;
    // If hidden but selected product needs this option, show anyway
    if (ps.selectedProduct && key.startsWith('opt:')) {
      const optionName = key.slice(4);
      const p = ps.selectedProduct;
      if (p.option1Name === optionName || p.option2Name === optionName || p.option3Name === optionName) {
        return true;
      }
    }
    return false;
  });

  // Option columns for checkboxes (exclude type/product)
  const optionColumnKeys = ps.activeColumns.filter(k => k.startsWith('opt:'));

  // Load color mappings
  useEffect(() => {
    if (currentShop?.id) {
      loadColorMappingsFromSupabase(currentShop.id);
    }
  }, [currentShop?.id]);

  const handleAddMovement = useCallback((item: Omit<StockMovement, 'quantity'>) => {
    tracker.addMovement(item);
    ps.resetSelection();
  }, [tracker, ps]);

  const handleConfirm = async () => {
    if (!currentShop || tracker.movements.length === 0) return;

    setProcessing(true);
    try {
      const response = await fetch('/api/pos/stock/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: currentShop.id,
          locationId: currentLocation?.id,
          items: tracker.movements.map(m => ({
            variantId: m.variantId,
            quantity: m.quantity,
            productTitle: m.productTitle,
            variantTitle: m.variantTitle,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error('Erreur lors de la mise à jour du stock');
      }

      const total = tracker.totalOut + tracker.totalReturn;
      notifications.show({
        title: 'Stock mis à jour',
        message: `${total} mouvement${total > 1 ? 's' : ''} enregistré${total > 1 ? 's' : ''}`,
        color: 'teal',
      });

      tracker.clearMovements();
      ps.refreshInventory();
    } catch (error) {
      console.error('Stock adjustment error:', error);
      notifications.show({
        title: 'Erreur',
        message: 'Une erreur est survenue lors de la mise à jour du stock',
        color: 'orange',
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className={styles.caisseContainer}>
      {/* Column visibility checkboxes */}
      {optionColumnKeys.length > 0 && (
        <div className={styles.columnToggles}>
          <Group gap="md">
            {optionColumnKeys.map(key => (
              <Checkbox
                key={key}
                label={ps.getColumnLabel(key)}
                checked={!hiddenColumns.has(key)}
                onChange={() => toggleColumn(key)}
                size="xs"
                color="gray"
              />
            ))}
          </Group>
        </div>
      )}

      <SelectionZone
        loading={ps.loading}
        columnOrder={ps.columnOrder}
        setColumnOrder={ps.setColumnOrder}
        activeColumns={visibleColumns}
        selections={ps.selections}
        selectColumn={ps.selectColumn}
        getValuesForColumn={ps.getValuesForColumn}
        getColumnLabel={ps.getColumnLabel}
        selectedVariant={ps.selectedVariant}
        selectedProduct={ps.selectedProduct}
        onAddMovement={handleAddMovement}
      />

      <StockZone
        movements={tracker.movements}
        totalOut={tracker.totalOut}
        totalReturn={tracker.totalReturn}
        isReturnMode={tracker.isReturnMode}
        onUndo={tracker.undoMovement}
        onClear={tracker.clearMovements}
        onToggleReturnMode={tracker.setReturnMode}
        onConfirm={handleConfirm}
        processing={processing}
      />
    </div>
  );
}
