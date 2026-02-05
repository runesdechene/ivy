'use client';

import { useState, useEffect, useCallback } from 'react';
import { notifications } from '@mantine/notifications';
import { createClient } from '@supabase/supabase-js';
import { useShop } from '@/context/ShopContext';
import { useLocation } from '@/context/LocationContext';
import { loadColorMappingsFromSupabase } from '@/utils/color-transformer';
import { SelectionZone } from './components/SelectionZone';
import { CartZone } from './components/CartZone';
import { PaymentModal } from './components/PaymentModal';
import { useCart } from './hooks/useCart';
import { useProductSelection } from './hooks/useProductSelection';
import { DiscountRule } from './types';
import styles from './caisse.module.scss';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function CaissePage() {
  const { currentShop } = useShop();
  const { currentLocation } = useLocation();
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);

  const cart = useCart();
  const productSelection = useProductSelection(currentShop?.id, currentLocation?.id);

  // Load color mappings
  useEffect(() => {
    if (currentShop?.id) {
      loadColorMappingsFromSupabase(currentShop.id);
    }
  }, [currentShop?.id]);

  // Load discount rules
  useEffect(() => {
    if (!currentShop?.id) return;

    const loadDiscountRules = async () => {
      const { data } = await supabase
        .from('pos_discount_rules')
        .select('*')
        .eq('shop_id', currentShop.id)
        .eq('is_active', true)
        .order('priority', { ascending: false });

      if (data) {
        const rules: DiscountRule[] = data.map(r => ({
          id: r.id,
          shopId: r.shop_id,
          name: r.name,
          description: r.description,
          expression: r.expression,
          priority: r.priority,
          isActive: r.is_active,
          isCombinable: r.is_combinable,
        }));
        cart.setDiscountRules(rules);
      }
    };

    loadDiscountRules();
  }, [currentShop?.id]);

  const handleAddToCart = useCallback((item: Parameters<typeof cart.addItem>[0]) => {
    cart.addItem(item);
    // Reset selection after adding to cart
    productSelection.resetSelection();
  }, [cart, productSelection]);

  const handleConfirmPayment = async (sellerId: string | null, customerEmail: string | null, customerPhone: string | null) => {
    if (!currentShop || cart.items.length === 0) return;

    setProcessingPayment(true);
    try {
      // Create sale
      const response = await fetch('/api/pos/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: currentShop.id,
          locationId: currentLocation?.id || null,
          sellerId,
          customerEmail,
          customerPhone,
          discountRuleId: cart.activeDiscountRule?.id || null,
          subtotal: cart.subtotal,
          discountAmount: cart.totalDiscount,
          totalAmount: cart.total,
          itemsCount: cart.itemsCount,
          isRefund: cart.isRefund,
          items: cart.items.map(item => ({
            variantId: item.variantId,
            productTitle: item.productTitle,
            variantTitle: item.variantTitle,
            quantity: item.quantity,
            unitPrice: item.price,
            discountPercentage: item.discountPercentage,
            discountAmount: item.discountAmount,
            totalPrice: item.price * item.quantity - item.discountAmount,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error('Erreur lors de la création de la vente');
      }

      // Adjust stock
      const stockResponse = await fetch('/api/pos/stock/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: currentShop.id,
          locationId: currentLocation?.id,
          items: cart.items.map(item => ({
            variantId: item.variantId,
            quantity: -item.quantity, // Negative to decrease stock (or positive for refunds)
          })),
        }),
      });

      if (!stockResponse.ok) {
        console.error('Stock adjustment failed, but sale was recorded');
      }

      notifications.show({
        title: cart.isRefund ? 'Remboursement effectué' : 'Vente enregistrée',
        message: `${cart.itemsCount} article(s) - ${Math.abs(cart.total).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`,
        color: 'green',
      });

      cart.clearCart();
      setPaymentModalOpen(false);
    } catch (error) {
      console.error('Payment error:', error);
      notifications.show({
        title: 'Erreur',
        message: 'Une erreur est survenue lors de l\'enregistrement',
        color: 'red',
      });
    } finally {
      setProcessingPayment(false);
    }
  };

  return (
    <div className={styles.caisseContainer}>
      <SelectionZone
        loading={productSelection.loading}
        productTypes={productSelection.productTypes}
        products={productSelection.products}
        colorOptions={productSelection.colorOptions}
        sizeOptions={productSelection.sizeOptions}
        option3Options={productSelection.option3Options}
        selection={productSelection.selection}
        selectedVariant={productSelection.selectedVariant}
        onSelectType={productSelection.selectType}
        onSelectProduct={productSelection.selectProduct}
        onSelectColor={productSelection.selectColor}
        onSelectSize={productSelection.selectSize}
        onSelectOption3={productSelection.selectOption3}
        onAddToCart={handleAddToCart}
      />

      <CartZone
        items={cart.items}
        subtotal={cart.subtotal}
        totalDiscount={cart.totalDiscount}
        total={cart.total}
        itemsCount={cart.itemsCount}
        isRefund={cart.isRefund}
        discountEnabled={cart.discountEnabled}
        activeDiscountRule={cart.activeDiscountRule}
        onIncrementQuantity={cart.incrementQuantity}
        onDecrementQuantity={cart.decrementQuantity}
        onRemoveItem={cart.removeItem}
        onClearCart={cart.clearCart}
        onToggleDiscount={cart.setDiscountEnabled}
        onConfirm={() => setPaymentModalOpen(true)}
      />

      <PaymentModal
        opened={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        onConfirm={handleConfirmPayment}
        items={cart.items}
        subtotal={cart.subtotal}
        totalDiscount={cart.totalDiscount}
        total={cart.total}
        itemsCount={cart.itemsCount}
        isRefund={cart.isRefund}
        shopId={currentShop?.id}
        loading={processingPayment}
      />
    </div>
  );
}
