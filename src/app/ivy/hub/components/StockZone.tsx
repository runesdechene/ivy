'use client';

import { ActionIcon, Button, Switch, Text } from '@mantine/core';
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
          <span>Sorties</span>
          {(totalOut + totalReturn) > 0 && (
            <span style={{
              background: 'var(--mantine-color-orange-6)',
              color: 'white',
              borderRadius: '50%',
              width: 24,
              height: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.8rem',
              fontWeight: 600,
            }}>
              {totalOut + totalReturn}
            </span>
          )}
        </div>
        {movements.length > 0 && (
          <ActionIcon
            variant="subtle"
            color="red"
            onClick={onClear}
            title="Réinitialiser"
          >
            <IconTrash size={18} />
          </ActionIcon>
        )}
      </div>

      {/* Items */}
      <div className={styles.cartItems}>
        {movements.length === 0 ? (
          <div className={styles.emptyCart}>
            <div className={styles.emptyCartIcon}>📦</div>
            <Text size="sm" c="dimmed">Aucun mouvement</Text>
            <Text size="xs" c="dimmed">Sélectionnez des produits</Text>
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
                  <Text size="xs" c="dimmed">{movement.variantTitle}</Text>
                </div>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={() => onUndo(movement.variantId)}
                  title="Annuler un"
                >
                  <IconArrowBackUp size={14} />
                </ActionIcon>
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
        <div className={styles.discountToggle}>
          <div className={styles.discountName}>
            <IconRotate size={16} />
            <span>Mode retour</span>
          </div>
          <Switch
            checked={isReturnMode}
            onChange={(e) => onToggleReturnMode(e.currentTarget.checked)}
            color="blue"
            size="sm"
          />
        </div>

        {movements.length > 0 && (
          <div className={styles.cartTotals}>
            <div className={`${styles.totalRow}`}>
              <span>Sorties</span>
              <span>{totalOut} article{totalOut > 1 ? 's' : ''}</span>
            </div>
            {totalReturn > 0 && (
              <div className={`${styles.totalRow}`}>
                <span>Retours</span>
                <span>+{totalReturn} article{totalReturn > 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
        )}

        <Button
          className={styles.confirmButton}
          color="orange"
          disabled={movements.length === 0}
          loading={processing}
          onClick={onConfirm}
        >
          Mettre à jour le stock
        </Button>
      </div>
    </div>
  );
}
