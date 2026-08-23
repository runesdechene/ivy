'use client';

import { Loader, Drawer, Button } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconShoppingCart, IconRotate } from '@tabler/icons-react';
import { StockMovement, VariantOption, SelectedProduct } from '../types';
import { ColumnKey, ColumnValue } from '../hooks/useProductSelection';
import { useAutoAddMovement } from '../hooks/useAutoAddMovement';
import { getColorHex } from '@/utils/color-transformer';
import { isColorColumn } from '../colorColumn';
import { StockZone } from './StockZone';
import styles from '../caisse.module.scss';

interface HubMobileProps {
  // Sélection
  loading: boolean;
  columns: ColumnKey[]; // colonnes visibles (= visibleColumns du parent)
  columnOrder: ColumnKey[];
  selections: Record<ColumnKey, string | null>;
  selectColumn: (key: ColumnKey, value: string) => void;
  resetSelection: () => void;
  getValuesForColumn: (key: ColumnKey) => ColumnValue[];
  getColumnLabel: (key: ColumnKey) => string;
  selectedVariant: VariantOption | null;
  selectedProduct: SelectedProduct | null;
  onAddMovement: (item: Omit<StockMovement, 'quantity'>) => void;
  // Panier
  movements: StockMovement[];
  totalOut: number;
  totalReturn: number;
  isReturnMode: boolean;
  onUndo: (variantId: string) => void;
  onClear: () => void;
  onToggleReturnMode: (enabled: boolean) => void;
  /** Retourne false si des lignes sont restées au panier → on garde le tiroir ouvert. */
  onConfirm: () => boolean | void | Promise<boolean | void>;
  processing: boolean;
}

export function HubMobile({
  loading, columns, columnOrder, selections, selectColumn, resetSelection,
  getValuesForColumn, getColumnLabel, selectedVariant, selectedProduct, onAddMovement,
  movements, totalOut, totalReturn, isReturnMode, onUndo, onClear,
  onToggleReturnMode, onConfirm, processing,
}: HubMobileProps) {
  const [cartOpened, cart] = useDisclosure(false);

  // Auto-ajout partagé avec le desktop
  useAutoAddMovement(selectedVariant, selectedProduct, columnOrder, selections, onAddMovement);

  const totalCount = totalOut + totalReturn;
  const totalSteps = columns.length;

  // Étape courante = première colonne visible sans sélection
  const stepIndex = columns.findIndex(k => !selections[k]);
  const currentKey = stepIndex === -1 ? null : columns[stepIndex];

  // Label d'une colonne déjà remplie (fil d'Ariane)
  const crumbLabel = (key: ColumnKey): string => {
    if (key === 'product') return selectedProduct?.title ?? selections[key] ?? '';
    return selections[key] ?? '';
  };

  // Rouvrir l'étape i : re-sélectionner la valeur courante de la colonne i-1
  // efface automatiquement tout ce qui suit (cf. selectColumn). i <= 0 → reset.
  const reopenStep = (i: number) => {
    if (i <= 0) { resetSelection(); return; }
    const prevKey = columns[i - 1];
    const prevValue = selections[prevKey];
    if (prevValue) selectColumn(prevKey, prevValue);
  };

  if (loading) {
    return (
      <div className={styles.mobileHub}>
        <div className={styles.mobileLoading}><Loader color="moss" size="lg" /></div>
      </div>
    );
  }

  const values = currentKey ? getValuesForColumn(currentKey) : [];
  const isColor = currentKey ? isColorColumn(getColumnLabel(currentKey)) : false;
  const reachedSteps = stepIndex === -1 ? totalSteps : stepIndex;
  const progressPct = totalSteps > 0 ? Math.round((reachedSteps / totalSteps) * 100) : 0;
  const stepLabel = Math.min(reachedSteps + 1, totalSteps);

  return (
    <div className={styles.mobileHub}>
      <div className={styles.mobileHead}>
        <div className={styles.mobileStepRow}>
          <div className={styles.mobileStepTitle}>
            {currentKey ? getColumnLabel(currentKey) : '—'}
          </div>
          <div className={styles.mobileStepCount}>
            Étape {stepLabel} / {totalSteps}
          </div>
        </div>

        <div className={styles.mobileCrumbs}>
          {columns
            .map((key, i) => ({ key, i }))
            .filter(({ i }) => i !== stepIndex) // la colonne courante = titre, pas dans le fil
            .map(({ key, i }, idx, rendered) => {
              const isFilled = stepIndex === -1 || i < stepIndex;
              const notLast = idx < rendered.length - 1;
              return (
                <span key={key} className={styles.mobileCrumbWrap}>
                  {isFilled ? (
                    <button
                      type="button"
                      className={styles.mobileCrumb}
                      onClick={() => reopenStep(i)}
                    >
                      {(crumbLabel(key) || getColumnLabel(key)) + ' ✕'}
                    </button>
                  ) : (
                    <span className={`${styles.mobileCrumb} ${styles.mobileCrumbTodo}`}>
                      {getColumnLabel(key)}
                    </span>
                  )}
                  {notLast && <span className={styles.mobileCrumbSep}>›</span>}
                </span>
              );
            })}
        </div>

        <div className={styles.mobileProgress}>
          <i style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <div className={styles.mobileOptions}>
        {!currentKey ? (
          <div className={styles.mobileEmpty}><Loader color="moss" /></div>
        ) : values.length === 0 ? (
          <div className={styles.mobileEmpty}>—</div>
        ) : (
          values.map(item => {
            const hex = isColor ? getColorHex(item.label) : null;
            const isOos = item.stock <= 0;
            return (
              <button
                key={item.value}
                className={`${styles.mobileOpt} ${isOos ? styles.mobileOptOos : ''}`}
                onClick={() => selectColumn(currentKey, item.value)}
              >
                {hex && <span className={styles.mobileSwatch} style={{ backgroundColor: hex }} />}
                <span className={styles.mobileOptLabel}>{item.label}</span>
                <span className={styles.mobileOptStock}>{item.stock}</span>
              </button>
            );
          })
        )}
      </div>

      <div className={styles.mobileBar}>
        <button type="button" className={styles.mobileCartChip} onClick={cart.open}>
          <IconShoppingCart size={18} />
          <span className={styles.mobileCount}>{totalCount}</span>
        </button>
        <button
          type="button"
          className={`${styles.mobileRetour} ${isReturnMode ? styles.mobileRetourOn : ''}`}
          onClick={() => onToggleReturnMode(!isReturnMode)}
        >
          <IconRotate size={16} />
          {isReturnMode ? 'Retour' : 'Sortie'}
        </button>
        <Button
          className={styles.mobileValid}
          color="moss"
          size="md"
          disabled={movements.length === 0}
          loading={processing}
          onClick={onConfirm}
        >
          Valider
        </Button>
      </div>

      <Drawer
        opened={cartOpened}
        onClose={cart.close}
        position="bottom"
        size="85%"
        withCloseButton={false}
        padding={0}
        styles={{
          content: { display: 'flex', flexDirection: 'column' },
          body: { padding: 0, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 },
        }}
      >
        <StockZone
          movements={movements}
          totalOut={totalOut}
          totalReturn={totalReturn}
          isReturnMode={isReturnMode}
          onUndo={onUndo}
          onClear={onClear}
          onToggleReturnMode={onToggleReturnMode}
          onConfirm={async () => {
            const ok = await onConfirm();
            // Des lignes en échec restent au panier : on laisse le tiroir ouvert
            // pour qu'elles soient vues, pas juste signalées par une notification.
            if (ok !== false) cart.close();
          }}
          processing={processing}
        />
      </Drawer>
    </div>
  );
}
