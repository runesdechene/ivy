'use client';

import { ActionIcon, Button, Switch, Text } from '@mantine/core';
import { IconShoppingCart, IconTrash, IconTag, IconBuildingStore } from '@tabler/icons-react';
import { CartItem, DiscountRule } from '../types';
import styles from '../caisse.module.scss';

interface CartZoneProps {
  items: CartItem[];
  subtotal: number;
  totalDiscount: number;
  total: number;
  itemsCount: number;
  isRefund: boolean;
  discountEnabled: boolean;
  activeDiscountRule: DiscountRule | null;
  standPriceEnabled: boolean;
  standPriceAdjustment: number;
  onIncrementQuantity: (id: string) => void;
  onDecrementQuantity: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onClearCart: () => void;
  onToggleDiscount: (enabled: boolean) => void;
  onToggleStandPrice: (enabled: boolean) => void;
  onConfirm: () => void;
}

export function CartZone({
  items,
  subtotal,
  totalDiscount,
  total,
  itemsCount,
  isRefund,
  discountEnabled,
  activeDiscountRule,
  standPriceEnabled,
  standPriceAdjustment,
  onIncrementQuantity,
  onDecrementQuantity,
  onRemoveItem,
  onClearCart,
  onToggleDiscount,
  onToggleStandPrice,
  onConfirm,
}: CartZoneProps) {
  const formatPrice = (price: number) => {
    return price.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className={styles.cartZone}>
      {/* Header */}
      <div className={styles.cartHeader}>
        <div className={styles.cartTitle}>
          <IconShoppingCart size={20} />
          <span>Panier</span>
          {itemsCount > 0 && (
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
              {itemsCount}
            </span>
          )}
        </div>
        {items.length > 0 && (
          <ActionIcon 
            variant="subtle" 
            color="red" 
            onClick={onClearCart}
            title="Vider le panier"
          >
            <IconTrash size={18} />
          </ActionIcon>
        )}
      </div>

      {/* Items */}
      <div className={styles.cartItems}>
        {items.length === 0 ? (
          <div className={styles.emptyCart}>
            <div className={styles.emptyCartIcon}>🛒</div>
            <Text size="sm" c="dimmed">Panier vide</Text>
            <Text size="xs" c="dimmed">Sélectionnez des produits</Text>
          </div>
        ) : (
          items.map(item => (
            <div 
              key={item.id} 
              className={`${styles.cartItem} ${item.quantity < 0 ? styles.refundItem : ''}`}
            >
              <div className={styles.cartItemHeader}>
                <div className={styles.cartItemName}>
                  {item.productTitle}
                  <br />
                  <Text size="xs" c="dimmed">{item.variantTitle}</Text>
                </div>
                <ActionIcon 
                  variant="subtle" 
                  color="gray" 
                  size="sm"
                  onClick={() => onRemoveItem(item.variantId)}
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </div>
              <div className={styles.cartItemDetails}>
                <div className={styles.quantityControl}>
                  <button 
                    className={styles.quantityButton}
                    onClick={() => onDecrementQuantity(item.variantId)}
                  >
                    −
                  </button>
                  <span className={`${styles.quantityValue} ${item.quantity < 0 ? styles.negative : ''}`}>
                    {item.quantity}
                  </span>
                  <button 
                    className={styles.quantityButton}
                    onClick={() => onIncrementQuantity(item.variantId)}
                  >
                    +
                  </button>
                </div>
                <div className={styles.cartItemPrice}>
                  <div className={styles.unitPrice}>
                    {formatPrice(item.price)} € / unité
                  </div>
                  <div className={`${styles.linePrice} ${item.quantity < 0 ? styles.negative : ''}`}>
                    {item.quantity < 0 ? '−' : ''}{formatPrice(Math.abs(item.price * item.quantity))} €
                    {item.discountPercentage > 0 && (
                      <span className={styles.discountBadge}>
                        −{item.discountPercentage}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className={styles.cartFooter}>
        {items.length > 0 && (
          <>
            {/* Discount Toggle */}
            <div className={styles.discountToggle}>
              <div className={styles.discountName}>
                <IconTag size={16} />
                <span>{activeDiscountRule?.name || 'Aucune remise'}</span>
              </div>
              <Switch
                checked={discountEnabled}
                onChange={(e) => onToggleDiscount(e.currentTarget.checked)}
                color="green"
                size="sm"
              />
            </div>

            {/* Stand Price Toggle */}
            {standPriceAdjustment !== 0 && (
              <div className={styles.discountToggle}>
                <div className={styles.discountName}>
                  <IconBuildingStore size={16} />
                  <span>Prix de stand ({standPriceAdjustment > 0 ? '+' : ''}{formatPrice(standPriceAdjustment)} € / article)</span>
                </div>
                <Switch
                  checked={standPriceEnabled}
                  onChange={(e) => onToggleStandPrice(e.currentTarget.checked)}
                  color="orange"
                  size="sm"
                />
              </div>
            )}

            {/* Totals */}
            <div className={styles.cartTotals}>
              {totalDiscount > 0 && (
                <>
                  <div className={`${styles.totalRow} ${styles.subtotal}`}>
                    <span>Sous-total</span>
                    <span>{formatPrice(subtotal)} €</span>
                  </div>
                  <div className={`${styles.totalRow} ${styles.discount}`}>
                    <span>Remise</span>
                    <span>−{formatPrice(totalDiscount)} €</span>
                  </div>
                </>
              )}
              <div className={`${styles.totalRow} ${styles.grandTotal}`}>
                <span>{isRefund ? 'À rembourser' : 'Total'}</span>
                <span style={{ color: isRefund ? 'var(--mantine-color-red-6)' : undefined }}>
                  {isRefund ? '−' : ''}{formatPrice(Math.abs(total))} €
                </span>
              </div>
            </div>
          </>
        )}

        <Button
          className={styles.confirmButton}
          color={isRefund ? 'red' : 'orange'}
          disabled={items.length === 0}
          onClick={onConfirm}
        >
          {isRefund ? 'Confirmer le remboursement' : 'Confirmer la vente'}
        </Button>
      </div>
    </div>
  );
}
