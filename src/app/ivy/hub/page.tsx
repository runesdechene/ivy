'use client';

import { useState, useEffect, useCallback } from 'react';
import { notifications } from '@mantine/notifications';
import { Checkbox } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { HubMobile } from './components/HubMobile';
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
  const isMobile = useMediaQuery('(max-width: 767px)');

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

  /** Retourne false si des lignes sont restées au panier (à revalider). */
  const handleConfirm = async (): Promise<boolean> => {
    if (!currentShop || tracker.movements.length === 0) return true;

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

      const data = (await response.json()) as {
        success: boolean;
        results?: {
          label?: string;
          variantId: string;
          success: boolean;
          error?: string;
          shopifyFailed?: boolean;
          retryable?: boolean;
        }[];
        shopifyFailedCount?: number;
      };
      const results = data.results ?? [];
      const failed = results.filter(r => !r.success);
      // Rejouables = rien n'a été écrit, la ligne peut rester au panier telle
      // quelle. Les autres ont laissé un état partiel : on ne les remet PAS,
      // sinon une revalidation compterait deux fois.
      const retryable = failed.filter(r => r.retryable);
      const manual = failed.filter(r => !r.retryable);

      const okCount = results.length - failed.length;
      if (okCount > 0) {
        notifications.show({
          title: 'Stock mis à jour',
          message: `${okCount} mouvement${okCount > 1 ? 's' : ''} enregistré${okCount > 1 ? 's' : ''}`,
          color: 'moss',
        });
      }

      if (retryable.length > 0) {
        notifications.show({
          title: `⚠️ ${retryable.length} ligne${retryable.length > 1 ? 's' : ''} non synchronisée${retryable.length > 1 ? 's' : ''}`,
          message:
            (data.shopifyFailedCount ? 'La synchro Shopify a échoué. ' : '') +
            "Rien n'a été décompté pour ces lignes : elles restent au panier, en rouge. Revalide quand la connexion est revenue.",
          color: 'red',
          autoClose: false,
          withCloseButton: true,
        });
      }

      if (manual.length > 0) {
        // État partiel : Shopify est peut-être à jour, Ivy non. Revalider est
        // dangereux → on sort la ligne du panier et on demande un contrôle.
        notifications.show({
          title: `🛑 ${manual.length} ligne${manual.length > 1 ? 's' : ''} à vérifier à la main`,
          message: manual
            .map(r => `• ${r.label ?? r.variantId} — ${r.error ?? 'échec'}`)
            .join('\n'),
          color: 'red',
          autoClose: false,
          withCloseButton: true,
          style: { whiteSpace: 'pre-line' },
        });
      }

      if (retryable.length > 0) {
        tracker.keepFailed(retryable);
      } else {
        tracker.clearMovements();
      }
      ps.refreshInventory();
      return failed.length === 0;
    } catch (error) {
      console.error('Stock adjustment error:', error);
      notifications.show({
        title: 'Erreur',
        message:
          "Le stock n'a pas pu être mis à jour. Les mouvements restent au panier — vérifie la connexion et revalide.",
        color: 'red',
        autoClose: false,
        withCloseButton: true,
      });
      return false;
    } finally {
      setProcessing(false);
    }
  };

  if (isMobile) {
    return (
      <div className={styles.caisseContainer}>
        <HubMobile
          loading={ps.loading}
          columns={visibleColumns}
          columnOrder={ps.columnOrder}
          selections={ps.selections}
          selectColumn={ps.selectColumn}
          resetSelection={ps.resetSelection}
          getValuesForColumn={ps.getValuesForColumn}
          getColumnLabel={ps.getColumnLabel}
          selectedVariant={ps.selectedVariant}
          selectedProduct={ps.selectedProduct}
          onAddMovement={handleAddMovement}
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

  return (
    <div className={styles.caisseContainer}>
      {/* Column visibility checkboxes */}
      {optionColumnKeys.length > 0 && (
        <div className={styles.columnToggles}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            {optionColumnKeys.map(key => (
              <Checkbox
                key={key}
                label={ps.getColumnLabel(key)}
                checked={!hiddenColumns.has(key)}
                onChange={() => toggleColumn(key)}
                size="xs"
                color="moss"
              />
            ))}
          </div>
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
