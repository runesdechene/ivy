'use client';

import { ActionIcon, Image, Group, Stack, Table, ScrollArea } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { ProductData } from './ProductCard';
import { StatusBadge } from '@/components/StatusBadge';
import styles from './ProductDetailPanel.module.scss';

interface ProductDetailPanelProps {
  product: ProductData;
  onClose: () => void;
}

export function ProductDetailPanel({ product, onClose }: ProductDetailPanelProps) {
  // Trier les variantes par taille
  const sortedVariants = [...product.variants].sort((a, b) => {
    const sizeOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'];
    const aIndex = a.size ? sizeOrder.indexOf(a.size.toUpperCase()) : 999;
    const bIndex = b.size ? sizeOrder.indexOf(b.size.toUpperCase()) : 999;
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return (a.size || '').localeCompare(b.size || '');
  });

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <ActionIcon
            variant="subtle"
            color="slate"
            size="lg"
            onClick={onClose}
            aria-label="Retour"
          >
            <IconArrowLeft size={20} />
          </ActionIcon>
          <span className={styles.headerTitle}>Détails du produit</span>
        </div>

        <ScrollArea className={styles.content}>
          <div className={styles.productInfo}>
            <div className={styles.imageSection}>
              {product.image ? (
                <Image
                  src={product.image}
                  alt={product.imageAlt}
                  radius="md"
                  h={250}
                  fit="contain"
                />
              ) : (
                <div className={styles.noImage}>Pas d&apos;image</div>
              )}
            </div>

            <Stack gap="md" className={styles.infoSection}>
              <div>
                <h2 className={styles.productTitle}>{product.title}</h2>
                <div className={styles.productHandle}>{product.handle}</div>
              </div>

              <div className={styles.stockTotal}>
                <div className={styles.stockLabel}>Stock total</div>
                <div>
                  <StatusBadge variant={product.totalQuantity > 0 ? 'moss' : 'rust'}>
                    {product.totalQuantity} unité{product.totalQuantity > 1 ? 's' : ''}
                  </StatusBadge>
                </div>
              </div>

              <div className={styles.sizeBreakdown}>
                <div className={styles.sizeBreakdownTitle}>Répartition par taille</div>
                <Group gap={6} className={styles.sizeBreakdownBadges}>
                  {Object.entries(product.sizeBreakdown).map(([size, qty]) => (
                    <StatusBadge
                      key={size}
                      variant={qty > 0 ? 'slate' : 'rust'}
                    >
                      {size}: {qty}
                    </StatusBadge>
                  ))}
                </Group>
              </div>
            </Stack>
          </div>

          <div className={styles.variantsSection}>
            <div className={styles.variantsTitle}>Détail des variantes</div>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Variante</Table.Th>
                  <Table.Th>SKU</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Quantité</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sortedVariants.map((variant) => (
                  <Table.Tr key={variant.id}>
                    <Table.Td>
                      <span className={styles.variantName}>{variant.title}</span>
                    </Table.Td>
                    <Table.Td>
                      <span className={styles.variantSku}>{variant.sku || '-'}</span>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <StatusBadge variant={variant.quantity > 0 ? 'moss' : 'rust'}>
                        {variant.quantity}
                      </StatusBadge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
