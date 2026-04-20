'use client';

import { Button } from '@mantine/core';
import { IconPackage, IconTrash, IconArrowBackUp, IconRotate } from '@tabler/icons-react';
import { StockMovement } from '../types';
import styles from '../caisse.module.scss';

interface StockZoneProps {
  movements: StockMovement[];
  totalOut: number;
  totalReturn: number;
  isReturnMode: boolean;
  onUndo: (variantId: string) => void;
  onClear: () => void;
  onToggleReturnMode: (enabled: boolean) => void;
  onConfirm: () => void;
  processing: boolean;
}

export function StockZone({
  movements,
  totalOut,
  totalReturn,
  isReturnMode,
  onUndo,
  onClear,
  onToggleReturnMode,
  onConfirm,
  processing,
}: StockZoneProps) {
  return (
    <div className={styles.cartZone}>
      {/* Header */}
      <div className={styles.cartHeader}>
        <div className={styles.cartTitle}>
          <IconPackage size={20} />
          <span>{isReturnMode ? 'Entrées' : 'Sorties'}</span>
          {(totalOut + totalReturn) > 0 && (
            <span className={styles.countBadge}>
              {totalOut + totalReturn}
            </span>
          )}
        </div>
        {movements.length > 0 && (
          <button
            className={styles.clearButton}
            onClick={onClear}
            title="Réinitialiser"
          >
            <IconTrash size={18} />
          </button>
        )}
      </div>

      {/* Items */}
      <div className={styles.cartItems}>
        {movements.length === 0 ? (
          <div className={styles.emptyCart}>
            <div className={styles.emptyCartIcon}>📦</div>
            <span className={styles.emptyText}>Aucun mouvement</span>
            <span className={styles.emptyTextSm}>Sélectionnez des produits</span>
          </div>
        ) : (
          movements.map(movement => (
            <div
              key={movement.variantId}
              className={`${styles.cartItem} ${movement.quantity > 0 ? styles.returnItem : ''}`}
            >
              <div className={styles.cartItemHeader}>
                <div className={styles.cartItemName}>
                  {movement.productTitle}
                  <br />
                  <span className={styles.variantText}>{movement.variantTitle}</span>
                </div>
                <button
                  className={styles.undoButton}
                  onClick={() => onUndo(movement.variantId)}
                  title="Annuler un"
                >
                  <IconArrowBackUp size={14} />
                </button>
              </div>
              <div className={styles.cartItemDetails}>
                <div className={styles.movementQuantity}>
                  <span className={movement.quantity < 0 ? styles.quantityOut : styles.quantityReturn}>
                    {movement.quantity > 0 ? '+' : ''}{movement.quantity}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className={styles.cartFooter}>
        {/* Return Mode Toggle */}
        <button
          type="button"
          className={`${styles.returnModeToggle} ${isReturnMode ? styles.active : ''}`}
          onClick={() => onToggleReturnMode(!isReturnMode)}
        >
          <IconRotate size={16} />
          <span>Mode retour</span>
          <span className={styles.returnModeDot} />
        </button>

        {movements.length > 0 && (
          <div className={styles.cartTotals}>
            <div className={`${styles.totalRow}`}>
              <span>{isReturnMode ? 'Entrées' : 'Sorties'}</span>
              <span>{isReturnMode ? totalReturn : totalOut} article{(isReturnMode ? totalReturn : totalOut) > 1 ? 's' : ''}</span>
            </div>
            {(isReturnMode ? totalOut > 0 : totalReturn > 0) && (
              <div className={`${styles.totalRow}`}>
                <span>{isReturnMode ? 'Sorties' : 'Retours'}</span>
                <span>{isReturnMode ? totalOut : totalReturn} article{(isReturnMode ? totalOut : totalReturn) > 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
        )}

        <Button
          className={styles.confirmButton}
          color="slate"
          disabled={movements.length === 0}
          loading={processing}
          onClick={onConfirm}
        >
          Valider les mouvements
        </Button>
      </div>
    </div>
  );
}
