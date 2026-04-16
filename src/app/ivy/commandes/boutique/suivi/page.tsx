'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader } from '@mantine/core';
import { IconCheckbox, IconSquare } from '@tabler/icons-react';
import { transformColor, loadColorMappingsFromSupabase } from '@/utils/color-transformer';
import { VariantCheckbox } from '@/components/VariantCheckbox';
import { generateVariantId, getColorFromVariant, getSizeFromVariant } from '@/utils/variant-helpers';
import { encodeFirestoreId } from '@/utils/firebase-helpers';
import { compareSizes } from '@/utils/size-helpers';
import { OrderDrawer } from '@/components/OrderDrawer/OrderDrawer';
import { useShop } from '@/context/ShopContext';
import { supabase } from '@/supabase/client';
import type { ShopifyOrder } from '@/types/shopify';
import styles from './suivi.module.scss';

interface GroupedVariant {
  sku: string;
  color: string;
  size: string;
  displayName: string;
  variants: Array<{
    orderId: string;
    orderNumber: string;
    productIndex: number;
    quantityIndex: number;
    variantId: string;
  }>;
  totalQuantity: number;
}

export default function SuiviInternePage() {
  const { currentShop } = useShop();
  const [variantsBySku, setVariantsBySku] = useState<Map<string, GroupedVariant[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<ShopifyOrder | null>(null);
  const [drawerOpened, setDrawerOpened] = useState(false);

  const loadVariants = useCallback(async () => {
    if (!currentShop) return;

    try {
      setLoading(true);

      // Charger les mappings de couleurs
      await loadColorMappingsFromSupabase(currentShop.id);

      // Récupérer toutes les commandes en cours (non expédiées, non remboursées, non annulées)
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .eq('shop_id', currentShop.id)
        .is('cancelled_at', null)
        .neq('display_fulfillment_status', 'FULFILLED')
        .neq('display_financial_status', 'REFUNDED');

      if (ordersError) throw ordersError;

      // Grouper les variantes par SKU
      const groupedVariants = new Map<string, GroupedVariant[]>();

      orders?.forEach((order: any) => {
        const lineItems = order.line_items || [];

        lineItems.forEach((item: any, productIndex: number) => {
          // Ignorer les articles annulés
          if (item.isCancelled) return;

          const sku = item.sku || 'Sans SKU';
          if (!groupedVariants.has(sku)) {
            groupedVariants.set(sku, []);
          }

          // Extraire la couleur et la taille
          const color = transformColor(getColorFromVariant(item));
          const size = getSizeFromVariant(item);
          const encodedOrderId = encodeFirestoreId(order.shopify_id);

          // Chercher un groupe existant avec le même SKU, couleur et taille
          const variants = groupedVariants.get(sku)!;
          const existingGroup = variants.find(g =>
            g.sku === sku &&
            g.color === color &&
            g.size === size
          );

          const quantity = item.quantity || 1;

          if (existingGroup) {
            // Ajouter les variantes au groupe existant
            for (let i = 0; i < quantity; i++) {
              existingGroup.variants.push({
                orderId: encodedOrderId,
                orderNumber: order.order_number?.toString() || order.name || '',
                productIndex,
                quantityIndex: i,
                variantId: generateVariantId(
                  encodedOrderId,
                  sku,
                  color,
                  size,
                  productIndex,
                  i
                )
              });
            }
            existingGroup.totalQuantity += quantity;
          } else {
            // Créer un nouveau groupe
            const displayName = `${sku} - ${color} - ${size}`.trim();

            variants.push({
              sku,
              color,
              size,
              displayName,
              variants: Array.from({ length: quantity }, (_, i) => ({
                orderId: encodedOrderId,
                orderNumber: order.order_number?.toString() || order.name || '',
                productIndex,
                quantityIndex: i,
                variantId: generateVariantId(
                  encodedOrderId,
                  sku,
                  color,
                  size,
                  productIndex,
                  i
                )
              })),
              totalQuantity: quantity
            });
          }
        });
      });

      setVariantsBySku(groupedVariants);
    } catch (err) {
      console.error('Error loading variants:', err);
      setError(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  }, [currentShop]);

  useEffect(() => {
    loadVariants();
  }, [loadVariants]);

  const handleOrderClick = async (orderId: string) => {
    if (!currentShop) return;

    try {
      // Décoder l'ID pour récupérer l'ID Shopify
      const shopifyId = `gid://shopify/Order/${orderId}`;

      const { data: order } = await supabase
        .from('orders')
        .select('*')
        .eq('shop_id', currentShop.id)
        .eq('shopify_id', shopifyId)
        .single();

      if (order) {
        setSelectedOrder(order as unknown as ShopifyOrder);
        setDrawerOpened(true);
      }
    } catch (error) {
      console.error('Error fetching order:', error);
    }
  };

  const handleDrawerClose = () => {
    setDrawerOpened(false);
    setSelectedOrder(null);
  };

  const checkAllForSku = async (sku: string, check: boolean) => {
    if (!currentShop) return;

    const variants = variantsBySku.get(sku);
    if (!variants) return;

    // Collecter tous les variantIds pour ce SKU
    const allVariantIds: { variantId: string; orderId: string; color: string; size: string; productIndex: number; quantityIndex: number }[] = [];

    variants.forEach(group => {
      group.variants.forEach(v => {
        allVariantIds.push({
          variantId: v.variantId,
          orderId: v.orderId,
          color: group.color,
          size: group.size,
          productIndex: v.productIndex,
          quantityIndex: v.quantityIndex
        });
      });
    });

    // Upsert tous les checks en batch
    const upsertData = allVariantIds.map(v => ({
      id: v.variantId,
      shop_id: currentShop.id,
      order_id: v.orderId,
      sku,
      color: v.color || 'no-color',
      size: v.size || 'no-size',
      product_index: v.productIndex,
      quantity_index: v.quantityIndex,
      checked: check,
    }));

    await supabase
      .from('line_item_checks')
      .upsert(upsertData, { onConflict: 'id' });

    // Mettre à jour les compteurs de progression pour chaque commande affectée
    const orderIds = [...new Set(allVariantIds.map(v => v.orderId))];
    for (const orderId of orderIds) {
      const { count } = await supabase
        .from('line_item_checks')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', currentShop.id)
        .eq('order_id', orderId)
        .eq('checked', true);

      await supabase
        .from('order_progress')
        .upsert({
          shop_id: currentShop.id,
          order_id: orderId,
          checked_count: count || 0,
        }, { onConflict: 'shop_id,order_id' });
    }
  };

  const renderVariantsTable = (variants: GroupedVariant[]) => {
    // Trier les variantes par couleur puis par taille
    const sortedVariants = [...variants].sort((a, b) => {
      const colorCompare = a.color.localeCompare(b.color);
      if (colorCompare !== 0) return colorCompare;
      return compareSizes(a.size, b.size);
    });

    return (
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th} style={{ width: 220 }}>Commandé</th>
              <th className={styles.th}>Variante</th>
              <th className={styles.th} style={{ width: 200 }}>Commandes</th>
            </tr>
          </thead>
          <tbody>
            {sortedVariants.map((group) => (
              <tr
                key={`${group.sku}-${group.color}-${group.size}`}
                className={styles.row}
              >
                <td className={styles.td}>
                  <div className={styles.checkboxCell}>
                    {group.variants.map(({ orderId, productIndex, quantityIndex, variantId }) => (
                      <VariantCheckbox
                        key={variantId}
                        sku={group.sku}
                        color={group.color}
                        size={group.size}
                        quantity={1}
                        orderId={orderId}
                        productIndex={productIndex}
                        quantityIndex={quantityIndex}
                        variantId={variantId}
                      />
                    ))}
                  </div>
                </td>
                <td className={styles.td}>
                  <div className={styles.variantCell}>
                    <span className={styles.variantQty}>
                      {group.totalQuantity}<em>×</em>
                    </span>
                    <span className={styles.variantSku}>{group.sku}</span>
                    {group.color && (
                      <>
                        <span className={styles.variantSep}>·</span>
                        <span className={styles.variantOption}>{group.color}</span>
                      </>
                    )}
                    {group.size && (
                      <>
                        <span className={styles.variantSep}>·</span>
                        <span className={styles.variantOption}>{group.size}</span>
                      </>
                    )}
                  </div>
                </td>
                <td className={styles.td}>
                  <div className={styles.ordersCell}>
                    {[...new Set(group.variants.map(v => v.orderNumber))].map((orderNumber) => (
                      <span
                        key={orderNumber}
                        className={styles.orderNumber}
                        onClick={(e) => {
                          e.stopPropagation();
                          const variant = group.variants.find(v => v.orderNumber === orderNumber);
                          if (variant) handleOrderClick(variant.orderId);
                        }}
                      >
                        #{orderNumber}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const totalVariants = Array.from(variantsBySku.values()).reduce(
    (acc, variants) => acc + variants.reduce((sum, g) => sum + g.totalQuantity, 0),
    0
  );

  const totalSkus = variantsBySku.size;

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <div className={styles.pageHeadLeft}>
          <div className={styles.eyebrow}>Atelier · Runes de Chêne</div>
          <h1 className={styles.title}>
            Suivi <em>interne</em>
          </h1>
          <div className={styles.sub}>
            {loading ? (
              <span>Chargement…</span>
            ) : error ? (
              <span>Erreur de chargement</span>
            ) : totalVariants === 0 ? (
              <span>Aucune variante en attente</span>
            ) : (
              <>
                <span>{totalVariants} article{totalVariants > 1 ? 's' : ''} à traiter</span>
                <span className={styles.subSep}>·</span>
                <span>{totalSkus} référence{totalSkus > 1 ? 's' : ''}</span>
              </>
            )}
          </div>
        </div>
        {!loading && !error && totalVariants > 0 && (
          <div className={styles.headTotal}>
            {totalVariants} <em>en production</em>
          </div>
        )}
      </header>

      {loading ? (
        <div className={styles.loaderWrap}>
          <Loader size="lg" color="var(--moss)" />
        </div>
      ) : error ? (
        <div className={styles.errorWrap}>{error}</div>
      ) : variantsBySku.size === 0 ? (
        <div className={styles.emptyState}>
          Aucune variante textile à afficher. Toutes les commandes sont traitées.
        </div>
      ) : (
        <div>
          {Array.from(variantsBySku.entries())
            .sort(([skuA], [skuB]) => skuA.localeCompare(skuB))
            .map(([sku, variants]) => {
              const skuTotal = variants.reduce((sum, g) => sum + g.totalQuantity, 0);
              return (
                <section key={sku} className={styles.skuGroup}>
                  <header className={styles.skuHeader}>
                    <div className={styles.skuHeaderLeft}>
                      <h2 className={styles.skuLabel}>{sku}</h2>
                      <span className={styles.skuMeta}>
                        <em>{skuTotal}</em> article{skuTotal > 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className={styles.skuActions}>
                      <button
                        type="button"
                        className={`${styles.skuActionBtn} ${styles.skuActionBtnMoss}`}
                        onClick={() => checkAllForSku(sku, true)}
                        title="Tout cocher"
                      >
                        <IconCheckbox size={14} />
                        Tout cocher
                      </button>
                      <button
                        type="button"
                        className={styles.skuActionBtn}
                        onClick={() => checkAllForSku(sku, false)}
                        title="Tout décocher"
                      >
                        <IconSquare size={14} />
                        Tout décocher
                      </button>
                    </div>
                  </header>
                  {renderVariantsTable(variants)}
                </section>
              );
            })}
        </div>
      )}

      <OrderDrawer
        order={selectedOrder ?? undefined}
        opened={drawerOpened}
        onClose={handleDrawerClose}
      />
    </div>
  );
}
