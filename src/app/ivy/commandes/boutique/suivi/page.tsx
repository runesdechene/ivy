'use client';

import { useEffect, useState, useCallback } from 'react';
import { 
  Table, 
  Loader, 
  Text, 
  Stack, 
  Title, 
  Group, 
  Paper, 
  Badge,
  Center,
  ActionIcon,
  Tooltip
} from '@mantine/core';
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
      <Paper withBorder className={styles.tableContainer}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 200 }}>Commandé</Table.Th>
              <Table.Th style={{ width: '100%' }}>Variante</Table.Th>
              <Table.Th style={{ width: 150 }}>Commandes</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sortedVariants.map((group) => (
              <Table.Tr 
                key={`${group.sku}-${group.color}-${group.size}`}
                className={styles.tableRow}
              >
                <Table.Td>
                  <Group gap="xs">
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
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text>
                    <Badge variant="light" color="gray" mr="xs">{group.totalQuantity}×</Badge>
                    {group.sku} - {group.color} - {group.size}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {[...new Set(group.variants.map(v => v.orderNumber))].map((orderNumber) => (
                      <Text 
                        key={orderNumber}
                        className={styles.orderNumber}
                        onClick={(e) => {
                          e.stopPropagation();
                          const variant = group.variants.find(v => v.orderNumber === orderNumber);
                          if (variant) handleOrderClick(variant.orderId);
                        }}
                      >
                        #{orderNumber}
                      </Text>
                    ))}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    );
  };

  if (loading) {
    return (
      <Center h={400}>
        <Loader size="lg" />
      </Center>
    );
  }

  if (error) {
    return (
      <Center h={400}>
        <Text c="red">{error}</Text>
      </Center>
    );
  }

  const totalVariants = Array.from(variantsBySku.values()).reduce(
    (acc, variants) => acc + variants.reduce((sum, g) => sum + g.totalQuantity, 0),
    0
  );

  return (
    <div className={styles.pageContainer}>
      <Group justify="space-between" align="center" mb="lg">
        <Title order={2}>Suivi interne</Title>
        <Badge size="lg" variant="light" color="blue">
          {totalVariants} articles à traiter
        </Badge>
      </Group>

      {variantsBySku.size === 0 ? (
        <Paper withBorder p="xl" radius="md">
          <Center>
            <Text c="dimmed">
              Aucune variante textile à afficher. Toutes les commandes sont traitées.
            </Text>
          </Center>
        </Paper>
      ) : (
        <Stack gap="lg">
          {Array.from(variantsBySku.entries())
            .sort(([skuA], [skuB]) => skuA.localeCompare(skuB))
            .map(([sku, variants]) => (
              <Stack key={sku} gap="xs">
                <Group gap="sm">
                  <Title order={4} className={styles.skuTitle}>
                    {sku}
                    <Badge ml="sm" variant="light" color="gray">
                      {variants.reduce((sum, g) => sum + g.totalQuantity, 0)} articles
                    </Badge>
                  </Title>
                  <Tooltip label="Tout cocher">
                    <ActionIcon 
                      variant="light" 
                      color="green" 
                      size="sm"
                      onClick={() => checkAllForSku(sku, true)}
                    >
                      <IconCheckbox size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Tout décocher">
                    <ActionIcon 
                      variant="light" 
                      color="gray" 
                      size="sm"
                      onClick={() => checkAllForSku(sku, false)}
                    >
                      <IconSquare size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
                {renderVariantsTable(variants)}
              </Stack>
            ))}
        </Stack>
      )}

      <OrderDrawer
        order={selectedOrder ?? undefined}
        opened={drawerOpened}
        onClose={handleDrawerClose}
      />
    </div>
  );
}
