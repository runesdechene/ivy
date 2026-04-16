'use client';

import { Image, Badge } from '@mantine/core';
import { StatusBadge } from '@/components/StatusBadge';
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
    price?: number;
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
  const localVariants = product.variants.filter(v => v.shopifyActive === false);
  const localStock = localVariants.reduce((sum, v) => sum + Math.max(0, v.quantity), 0);

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
    .filter(([, qty]) => qty > 0)
    .map(([size, qty]) => `${qty} ${size}`)
    .join(', ');

  const inStock = product.totalQuantity > 0;

  return (
    <div
      className={styles.card}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
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
            Pas d&apos;image
          </div>
        )}
        <Badge
          className={styles.quantityBadge}
          size="lg"
          color={inStock ? 'moss' : 'rust'}
          variant="filled"
        >
          {product.totalQuantity}
        </Badge>
      </div>

      <div className={styles.body}>
        <div className={styles.title}>{product.title}</div>

        {sizeText && (
          <div className={styles.sizeText}>{sizeText}</div>
        )}

        {product.costRange && (
          <div className={`${styles.cost} ${product.costRange.min === 0 ? styles.warn : ''}`}>
            {product.costRange.min === product.costRange.max
              ? `${product.costRange.min.toFixed(2)} €`
              : `${product.costRange.min.toFixed(2)} – ${product.costRange.max.toFixed(2)} €`}
          </div>
        )}

        <div className={styles.metaRow}>
          <div className={styles.badgeGroup}>
            {isLocal ? (
              <StatusBadge variant="clay">Local seulement</StatusBadge>
            ) : (
              <>
                <StatusBadge variant="moss">Shopify</StatusBadge>
                {localVariants.length > 0 && (
                  <StatusBadge variant="clay">
                    + {localStock} locale{localStock > 1 ? 's' : ''}
                  </StatusBadge>
                )}
              </>
            )}
          </div>
          {missingMetafieldsCount > 0 && (
            <span className={styles.warnText}>
              ⚠ {missingMetafieldsCount} ligne{missingMetafieldsCount > 1 ? 's' : ''} sans méta
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
