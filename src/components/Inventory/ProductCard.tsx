'use client';

import { Paper, Image, Text, Badge, Group, Stack } from '@mantine/core';
import styles from './ProductCard.module.scss';

export interface ProductData {
  id: string;
  supabaseId?: string;
  title: string;
  handle: string;
  status?: string;
  image: string | null;
  imageAlt: string;
  productType?: string | null;
  totalQuantity: number;
  sizeBreakdown: Record<string, number>;
  costRange?: { min: number; max: number };
  variants: Array<{
    id: string;
    supabaseId?: string;
    title: string;
    sku: string;
    quantity: number;
    size: string | null;
    cost?: number;
    shopifyActive?: boolean;
    options: Array<{ name: string; value: string }>;
    metafields?: Array<{ namespace: string; key: string; value: string }>;
  }>;
}

interface ProductCardProps {
  product: ProductData;
  onClick: () => void;
}

export function ProductCard({ product, onClick }: ProductCardProps) {
  // Statut produit : local/draft = plus actif sur Shopify
  const isLocal = product.status === 'LOCAL' || product.status === 'DRAFT';
  const localVariantsCount = product.variants.filter(v => v.shopifyActive === false).length;

  // Métachamps manquants : comparer au minimum (parmi celles qui en ont) pour éviter les faux positifs recto/verso
  const shopifyVariants = product.variants.filter(v => v.shopifyActive !== false);
  const variantsWithMeta = shopifyVariants.filter(v => (v.metafields?.length || 0) > 0);
  const minMetafields = variantsWithMeta.length > 0
    ? variantsWithMeta.reduce((min, v) => Math.min(min, v.metafields!.length), Infinity)
    : 0;
  const missingMetafieldsCount = minMetafields > 0
    ? shopifyVariants.filter(v => (v.metafields?.length || 0) < minMetafields).length
    : 0;

  // Formater le breakdown des tailles
  const sizeText = Object.entries(product.sizeBreakdown)
    .filter(([_, qty]) => qty > 0)
    .map(([size, qty]) => `${qty} ${size}`)
    .join(', ');

  return (
    <Paper 
      className={styles.card} 
      withBorder 
      radius="md" 
      onClick={onClick}
      p={0}
    >
      <div className={styles.imageContainer}>
        {product.image ? (
          <Image
            src={product.image}
            alt={product.imageAlt}
            h={180}
            fit="cover"
          />
        ) : (
          <div className={styles.noImage}>
            <Text c="dimmed" size="sm">Pas d'image</Text>
          </div>
        )}
        <Badge 
          className={styles.quantityBadge}
          size="lg"
          color={product.totalQuantity > 0 ? 'green' : 'red'}
          variant="filled"
        >
          {product.totalQuantity}
        </Badge>
      </div>
      
      <Stack gap={4} p="sm">
        <Text fw={600} size="sm" lineClamp={2}>
          {product.title}
        </Text>
        {sizeText && (
          <Text size="xs" c="dimmed" lineClamp={1}>
            {sizeText}
          </Text>
        )}
        {product.costRange && (
          <Text size="xs" c={product.costRange.min === 0 ? 'orange' : 'blue'} fw={500}>
            {product.costRange.min === product.costRange.max
              ? `${product.costRange.min.toFixed(2)} €`
              : `${product.costRange.min.toFixed(2)} - ${product.costRange.max.toFixed(2)} €`
            }
          </Text>
        )}
        <Group gap={4} justify="space-between" wrap="nowrap">
          <Group gap={4}>
            {isLocal ? (
              <Badge size="xs" color="orange" variant="light">
                Local seulement
              </Badge>
            ) : (
              <>
                <Badge size="xs" color="teal" variant="light">
                  Shopify
                </Badge>
                {localVariantsCount > 0 && (
                  <Badge size="xs" color="orange" variant="light">
                    + {localVariantsCount} locale{localVariantsCount > 1 ? 's' : ''}
                  </Badge>
                )}
              </>
            )}
          </Group>
          {missingMetafieldsCount > 0 && (
            <Text size="xs" c="orange" fw={500} style={{ whiteSpace: 'nowrap' }}>
              ⚠ {missingMetafieldsCount} ligne{missingMetafieldsCount > 1 ? 's' : ''} sans méta
            </Text>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}
