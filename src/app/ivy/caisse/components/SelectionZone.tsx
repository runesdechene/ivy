'use client';

import { useEffect } from 'react';
import { Loader, Center } from '@mantine/core';
import { SelectedProduct, VariantOption, CartItem } from '../types';
import { getColorHex } from '@/utils/color-transformer';
import styles from '../caisse.module.scss';

// Vérifie si le nom de l'option correspond à une couleur
function isColorOptionName(optionName: string | null | undefined): boolean {
  if (!optionName) return false;
  const lower = optionName.toLowerCase();
  return lower.includes('couleur') || lower.includes('color');
}

interface SelectionZoneProps {
  loading: boolean;
  productTypes: VariantOption[];
  products: (SelectedProduct & { stock: number })[];
  colorOptions: VariantOption[];
  sizeOptions: VariantOption[];
  option3Options: VariantOption[];
  selection: {
    type: string | null;
    product: SelectedProduct | null;
    color: string | null;
    size: string | null;
    option3: string | null;
  };
  selectedVariant: VariantOption | null;
  onSelectType: (type: string) => void;
  onSelectProduct: (product: SelectedProduct) => void;
  onSelectColor: (color: string) => void;
  onSelectSize: (size: string) => void;
  onSelectOption3: (option3: string) => void;
  onAddToCart: (item: Omit<CartItem, 'id' | 'quantity' | 'discountPercentage' | 'discountAmount'>) => void;
}

export function SelectionZone({
  loading,
  productTypes,
  products,
  colorOptions,
  sizeOptions,
  option3Options,
  selection,
  selectedVariant,
  onSelectType,
  onSelectProduct,
  onSelectColor,
  onSelectSize,
  onSelectOption3,
  onAddToCart,
}: SelectionZoneProps) {
  // Auto-add to cart when variant is fully selected
  useEffect(() => {
    if (selectedVariant && selection.product) {
      onAddToCart({
        variantId: selectedVariant.variantId!,
        productId: selection.product.id,
        productTitle: selection.product.title,
        productType: selection.product.productType,
        variantTitle: `${selection.color} / ${selection.size}${selection.option3 ? ` / ${selection.option3}` : ''}`,
        options: {
          color: selection.color || undefined,
          size: selection.size || undefined,
          option3: selection.option3 || undefined,
        },
        price: selectedVariant.price || 0,
        cost: selectedVariant.cost || 0,
        stock: selectedVariant.stock,
      });
    }
  }, [selectedVariant]);

  if (loading) {
    return (
      <div className={styles.selectionZone}>
        <Center style={{ flex: 1 }}>
          <Loader size="lg" />
        </Center>
      </div>
    );
  }

  return (
    <div className={styles.selectionZone}>
      {/* Type Column */}
      <div className={styles.column}>
        <div className={styles.columnHeader}>Type</div>
        <div className={styles.columnContent}>
          {productTypes.map(typeOption => (
            <button
              key={typeOption.value}
              className={`${styles.optionButton} ${selection.type === typeOption.value ? styles.selected : ''} ${typeOption.stock <= 0 ? styles.outOfStock : ''}`}
              onClick={() => onSelectType(typeOption.value)}
            >
              <span>{typeOption.value}</span>
              <span className={styles.stockCount}>({typeOption.stock})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Product Column */}
      {selection.type && (
        <div className={styles.column}>
          <div className={styles.columnHeader}>Produit</div>
          <div className={styles.columnContent}>
            {products.map(product => (
              <button
                key={product.id}
                className={`${styles.optionButton} ${selection.product?.id === product.id ? styles.selected : ''} ${product.stock <= 0 ? styles.outOfStock : ''}`}
                onClick={() => onSelectProduct(product)}
              >
                <span>{product.title}</span>
                <span className={styles.stockCount}>({product.stock})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Option1 Column */}
      {selection.product && colorOptions.length > 0 && (
        <div className={styles.column}>
          <div className={styles.columnHeader}>
            {selection.product.option1Name || 'Option 1'}
          </div>
          <div className={styles.columnContent}>
            {colorOptions.map(option => {
              // Afficher la bulle de couleur si le nom de l'option contient "couleur" ou "color"
              const isColorColumn = isColorOptionName(selection.product?.option1Name);
              const hex = isColorColumn ? getColorHex(option.value) : null;
              const isOutOfStock = option.stock <= 0;
              return (
                <button
                  key={option.value}
                  className={`${styles.optionButton} ${selection.color === option.value ? styles.selected : ''} ${isOutOfStock ? styles.outOfStock : ''}`}
                  onClick={() => onSelectColor(option.value)}
                >
                  {hex && (
                    <div 
                      className={styles.colorSwatch} 
                      style={{ backgroundColor: hex }}
                    />
                  )}
                  <span>{option.value}</span>
                  <span className={styles.stockCount}>({option.stock})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Option2 Column */}
      {selection.color && sizeOptions.length > 0 && (
        <div className={styles.column}>
          <div className={styles.columnHeader}>
            {selection.product?.option2Name || 'Option 2'}
          </div>
          <div className={styles.columnContent}>
            {sizeOptions.map(option => {
              const isColorColumn = isColorOptionName(selection.product?.option2Name);
              const hex = isColorColumn ? getColorHex(option.value) : null;
              const isOutOfStock = option.stock <= 0;
              return (
                <button
                  key={option.value}
                  className={`${styles.optionButton} ${selection.size === option.value ? styles.selected : ''} ${isOutOfStock ? styles.outOfStock : ''}`}
                  onClick={() => onSelectSize(option.value)}
                >
                  {hex && (
                    <div 
                      className={styles.colorSwatch} 
                      style={{ backgroundColor: hex }}
                    />
                  )}
                  <span>{option.value}</span>
                  <span className={styles.stockCount}>({option.stock})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Option3 Column */}
      {selection.size && option3Options.length > 0 && (
        <div className={styles.column}>
          <div className={styles.columnHeader}>
            {selection.product?.option3Name || 'Option'}
          </div>
          <div className={styles.columnContent}>
            {option3Options.map(option => {
              const isOutOfStock = option.stock <= 0;
              return (
                <button
                  key={option.value}
                  className={`${styles.optionButton} ${selection.option3 === option.value ? styles.selected : ''} ${isOutOfStock ? styles.outOfStock : ''}`}
                  onClick={() => onSelectOption3(option.value)}
                >
                  <span>{option.value}</span>
                  <span className={styles.stockCount}>({option.stock})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
