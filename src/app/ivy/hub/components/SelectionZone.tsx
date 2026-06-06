'use client';

import { useAutoAddMovement } from '../hooks/useAutoAddMovement';
import { Loader } from '@mantine/core';
import { StockMovement, VariantOption, SelectedProduct } from '../types';
import { ColumnKey, ColumnValue } from '../hooks/useProductSelection';
import { getColorHex } from '@/utils/color-transformer';
import { isColorColumn } from '../colorColumn';
import styles from '../caisse.module.scss';

interface SelectionZoneProps {
  loading: boolean;
  columnOrder: ColumnKey[];
  setColumnOrder: (order: ColumnKey[]) => void;
  activeColumns: ColumnKey[];
  selections: Record<ColumnKey, string | null>;
  selectColumn: (key: ColumnKey, value: string) => void;
  getValuesForColumn: (key: ColumnKey) => ColumnValue[];
  getColumnLabel: (key: ColumnKey) => string;
  selectedVariant: VariantOption | null;
  selectedProduct: SelectedProduct | null;
  onAddMovement: (item: Omit<StockMovement, 'quantity'>) => void;
}

export function SelectionZone({
  loading,
  columnOrder,
  setColumnOrder,
  activeColumns,
  selections,
  selectColumn,
  getValuesForColumn,
  getColumnLabel,
  selectedVariant,
  selectedProduct,
  onAddMovement,
}: SelectionZoneProps) {
  useAutoAddMovement(selectedVariant, selectedProduct, columnOrder, selections, onAddMovement);

  // Move column left/right in the full columnOrder
  const moveColumn = (colKey: ColumnKey, direction: 'left' | 'right') => {
    const idx = columnOrder.indexOf(colKey);
    if (idx === -1) return;

    const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= columnOrder.length) return;

    const newOrder = [...columnOrder];
    [newOrder[idx], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[idx]];
    setColumnOrder(newOrder);
  };

  if (loading) {
    return (
      <div className={styles.selectionZone}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Loader size="lg" color="moss" />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.selectionZone}>
      {activeColumns.map((colKey, position) => {
        const label = getColumnLabel(colKey);
        const values = getValuesForColumn(colKey);
        const selectedValue = selections[colKey];
        const isColor = isColorColumn(label);
        const isFirst = position === 0;
        const isLast = position === activeColumns.length - 1;

        // Column is active if the immediately previous visible column has a selection
        const previousFilled = position === 0 || !!selections[activeColumns[position - 1]];

        return (
          <div
            key={colKey}
            className={`${styles.column} ${(!previousFilled && position > 0) ? styles.columnDisabled : ''}`}
          >
            <div className={styles.columnHeader}>
              {!isFirst && (
                <button
                  className={styles.columnArrow}
                  onClick={(e) => { e.stopPropagation(); moveColumn(colKey, 'left'); }}
                >
                  ‹
                </button>
              )}
              <span className={styles.columnHeaderLabel}>{label}</span>
              {!isLast && (
                <button
                  className={styles.columnArrow}
                  onClick={(e) => { e.stopPropagation(); moveColumn(colKey, 'right'); }}
                >
                  ›
                </button>
              )}
            </div>
            <div className={styles.columnContent}>
              {(!previousFilled && position > 0) ? (
                <div className={styles.columnEmpty}>
                  <span className={styles.emptyLabel}>—</span>
                </div>
              ) : values.length === 0 ? (
                <div className={styles.columnEmpty}>
                  <span className={styles.emptyLabel}>—</span>
                </div>
              ) : (
                values.map(item => {
                  const hex = isColor ? getColorHex(item.label) : null;
                  const isOutOfStock = item.stock <= 0;
                  return (
                    <button
                      key={item.value}
                      className={`${styles.optionButton} ${selectedValue === item.value ? styles.selected : ''} ${isOutOfStock ? styles.outOfStock : ''}`}
                      onClick={() => selectColumn(colKey, item.value)}
                    >
                      {hex && (
                        <div
                          className={styles.colorSwatch}
                          style={{ backgroundColor: hex }}
                        />
                      )}
                      <span>{item.label}</span>
                      <span className={styles.stockCount}>({item.stock})</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
