'use client';

import { FinancialStatus } from '@/components/FinancialStatus';
import { VariantCheckbox } from '@/components/VariantCheckbox';
import { InvoiceCheckbox } from '@/components/InvoiceCheckbox/InvoiceCheckbox';
import { TextileProgress } from '@/components/TextileProgress/TextileProgress';
import { generateVariantId } from '@/utils/variant-helpers';
import { formatAmount } from '@/utils/format-helpers';
import type { ShopifyOrder } from '@/types/shopify';
import styles from './OrderDrawer.module.scss';
import { encodeFirestoreId } from '@/utils/firebase-helpers';
import { Stack, Group, Text, Title, Paper, Image, Alert, List, Badge, Button } from '@mantine/core';
import { IconAlertTriangle, IconMessage } from '@tabler/icons-react';
import { useEffect, useRef } from 'react';
import { db } from '@/firebase/config';
import { doc, setDoc } from 'firebase/firestore';
import { generatePrintContent } from '@/utils/print-content';
import { printInIframe } from '@/utils/print-helpers';
import { getDefaultSku } from '@/utils/variant-helpers';
import { transformColor } from '@/utils/color-transformer';

interface OrderDrawerContentProps {
  order: ShopifyOrder;
}

export function OrderDrawerContent({ order }: OrderDrawerContentProps) {
  const encodedOrderId = encodeFirestoreId(order.id);

  const handlePrint = () => {
    const content = generatePrintContent({ order });
    printInIframe({ content });
  };

  useEffect(() => {
    const updateProgress = async () => {
      // Calculer le nombre total de variantes
      const totalCount = order.lineItems?.reduce((total, item) => 
        total + (item.isCancelled ? 0 : item.quantity),
        0
      ) ?? 0;

      // Mettre à jour uniquement le total
      const progressRef = doc(db, 'textile-progress-v2', encodedOrderId);
      await setDoc(progressRef, {
        totalCount,
        updatedAt: new Date().toISOString()
      }, { merge: true });  // merge: true pour ne pas écraser checkedCount
    };

    updateProgress();
  }, [order.id, order.lineItems, encodedOrderId]);
  
  return (
    <Stack gap="xl" mt="md">
      <Group gap="md">
        <Title order={3} className={styles.drawer_title}>{order.name}</Title>
        <FinancialStatus status={order.displayFinancialStatus} />
      </Group>

      <Stack gap="xs">
        <Text size="sm" c="dimmed">Textile commandé</Text>
        <TextileProgress orderId={encodedOrderId} />
      </Stack>

      <Stack gap="xs">
        <Text size="sm" c="dimmed">Total à facturer</Text>
        <Group gap="md" align="center">
          <Text fw={500}>
            {formatAmount(order.lineItems?.reduce((total, item) => 
              total + (item.isCancelled ? 0 : ((item.unitCost ?? 0) * item.quantity)),
              0
            ) ?? 0)} {order.totalPriceCurrency}
          </Text>
          <InvoiceCheckbox orderId={encodedOrderId} />
        </Group>
      </Stack>

      <Stack gap="xs">
        <Text size="sm" c="dimmed">Produits</Text>
        <Stack gap="md">
          {order.lineItems?.map((item, productIndex) => (
            <Paper 
              key={item.id} 
              className={`${styles.product_item} ${item.isCancelled ? styles.cancelled : ''}`}
              withBorder
              p={0}
            >
              <Group align="flex-start" gap={0} wrap="nowrap">
                {item.image && (
                  <Image
                    src={item.image.url}
                    alt={item.image.altText || item.title}
                    w={60}
                    h={60}
                    fit="contain"
                    m="md"
                  />
                )}
                <Stack gap="xs" style={{ flex: 1 }} p="md">
                  <Group justify="space-between" w="100%" align="center" gap={0} style={{ display: 'flex' }}>
                    <Stack gap={4} style={{ flex: '1', flexShrink: 0 }}>
                      <Text size="sm" fw={500}>{item.title}</Text>
                      <Text size="sm" c="dimmed">Coût unitaire: {formatAmount(item.unitCost ?? 0)} {order.totalPriceCurrency}</Text>
                      {item.variantTitle && (
                        <Text size="sm" c="dimmed">
                          {item.variantTitle.split(' / ').map((variant, index) => {
                            // Si c'est la première partie (la couleur)
                            if (index === 0) {
                              return transformColor(variant);
                            }
                            // Pour les autres parties (taille, matière, etc.)
                            return variant;
                          }).join(' / ')}
                        </Text>
                      )}
                      {item.sku && (
                        <Text size="xs" c="dimmed">SKU: {item.sku}</Text>
                      )}
                    </Stack>
                    <Group gap="xs" style={{ flex: 1, justifyContent: 'flex-end', display: 'flex' }}>
                      {item.isCancelled ? (
                        <Badge color="rust" variant="light">Annulée</Badge>
                      ) : (
                        <Group gap={4} style={{ flex: 1, justifyContent: 'flex-end', display: 'flex' }}>
                          {Array.from({ length: item.quantity }).map((_, index) => {
                            const color = item.variantTitle?.split(' / ')[0] || '';
                            const size = item.variantTitle?.split(' / ')[1] || '';
                            const sku = item.sku || getDefaultSku(item.title);
                            const variantId = generateVariantId(
                              encodedOrderId,
                              sku,
                              color,
                              size,
                              index,
                              productIndex
                            );
                            return (
                              <VariantCheckbox
                                key={variantId}
                                sku={sku}
                                color={color}
                                size={size}
                                quantity={1}
                                orderId={encodedOrderId}
                                productIndex={productIndex}
                                variantId={variantId}
                              />
                            );
                          })}
                        </Group>
                      )}
                      <Text size="sm" c="dimmed" w={30} ta="right">×{item.quantity}</Text>
                    </Group>
                  </Group>
                </Stack>
              </Group>
            </Paper>
          ))}
        </Stack>
      </Stack>

      {order.note && (
        <Alert 
          icon={<IconMessage size={16} />}
          title="Note"
          color="slate"
          variant="light"
        >
          {order.note}
        </Alert>
      )}

      <Alert 
        icon={<IconAlertTriangle size={16} />}
        title="Penser à :"
        color="gray"
        variant="light"
      >
        <List size="sm" spacing="xs">
          <List.Item>retirer etiquette Stanley/Stella</List.Item>
          <List.Item>Le mot de remerciement !</List.Item>
          <List.Item>le sticker</List.Item>
          <List.Item>Le Flyer !</List.Item>
        </List>
      </Alert>
      <Group justify="center" mt="xl">
        <Button size="lg" onClick={handlePrint}>
          Imprimer le bordereau
        </Button>
      </Group>
    </Stack>
  );
}
