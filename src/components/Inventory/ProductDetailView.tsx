'use client';

import { useState, useMemo } from 'react';
import { Button, Title, Text, Badge, Group, Stack, Table, Image, NumberInput, ActionIcon, Loader } from '@mantine/core';
import { IconArrowLeft, IconPhoto, IconPlus, IconMinus, IconDeviceFloppy } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { ProductData } from './ProductCard';
import { SortOptionsBar } from './SortOptionsBar';
import { getColorHex, isColorOption } from '@/utils/color-transformer';
import styles from './ProductDetailView.module.scss';

interface ProductDetailViewProps {
  product: ProductData;
  onBack: () => void;
  locationName?: string;
  shopId?: string;
  locationId?: string;
  onProductUpdated?: (updatedProduct: ProductData) => void;
}

export function ProductDetailView({ product, onBack, locationName, shopId, locationId, onProductUpdated }: ProductDetailViewProps) {
  // État local pour les quantités modifiées
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    product.variants.forEach(v => {
      initial[v.id] = v.quantity;
    });
    return initial;
  });
  const [saving, setSaving] = useState(false);

  // Détecter dynamiquement les options du produit
  const productOptions = useMemo(() => {
    const optionNames: string[] = [];
    // Parcourir les variantes pour trouver les noms d'options uniques
    for (const variant of product.variants) {
      if (variant.options) {
        for (const opt of variant.options) {
          if (opt.name && !optionNames.includes(opt.name)) {
            optionNames.push(opt.name);
          }
        }
      }
    }
    return optionNames;
  }, [product.variants]);

  // Déterminer l'ordre de tri par défaut (Taille en premier si présente)
  const defaultSortOrder = useMemo(() => {
    const sizeOptionIndex = productOptions.findIndex(opt => 
      opt.toLowerCase().includes('taille') || 
      opt.toLowerCase().includes('size')
    );
    if (sizeOptionIndex > 0) {
      // Mettre la taille en premier
      const reordered = [...productOptions];
      const [sizeOpt] = reordered.splice(sizeOptionIndex, 1);
      reordered.unshift(sizeOpt);
      return reordered;
    }
    return productOptions;
  }, [productOptions]);

  const [sortOrder, setSortOrder] = useState<string[]>(defaultSortOrder);

  // Vérifier si des modifications ont été faites
  const hasChanges = useMemo(() => {
    return product.variants.some(v => quantities[v.id] !== v.quantity);
  }, [product.variants, quantities]);

  // Calculer le nouveau total
  const newTotalQuantity = useMemo(() => {
    return Object.values(quantities).reduce((sum, qty) => sum + qty, 0);
  }, [quantities]);

  // Modifier la quantité d'une variante
  const handleQuantityChange = (variantId: string, value: number) => {
    setQuantities(prev => ({
      ...prev,
      [variantId]: Math.max(0, value),
    }));
  };

  // Incrémenter
  const handleIncrement = (variantId: string) => {
    setQuantities(prev => ({
      ...prev,
      [variantId]: (prev[variantId] || 0) + 1,
    }));
  };

  // Décrémenter
  const handleDecrement = (variantId: string) => {
    setQuantities(prev => ({
      ...prev,
      [variantId]: Math.max(0, (prev[variantId] || 0) - 1),
    }));
  };

  // Sauvegarder les modifications
  const handleSave = async () => {
    if (!shopId || !locationId) {
      notifications.show({
        title: 'Erreur',
        message: 'Shop ou emplacement non défini',
        color: 'red',
      });
      return;
    }

    setSaving(true);
    try {
      // Préparer les modifications (seulement les variantes modifiées)
      const changes = product.variants
        .filter(v => quantities[v.id] !== v.quantity)
        .map(v => ({
          variantId: v.id,
          quantity: quantities[v.id],
        }));

      if (changes.length === 0) {
        notifications.show({
          title: 'Aucune modification',
          message: 'Aucun stock n\'a été modifié',
          color: 'orange',
        });
        return;
      }

      const response = await fetch('/api/inventory/update-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId,
          locationId,
          productId: product.id,
          changes,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la mise à jour');
      }

      notifications.show({
        title: 'Stock mis à jour',
        message: `${changes.length} variante${changes.length > 1 ? 's' : ''} mise${changes.length > 1 ? 's' : ''} à jour`,
        color: 'green',
      });

      // Mettre à jour le produit parent si callback fourni
      if (onProductUpdated) {
        const updatedProduct: ProductData = {
          ...product,
          totalQuantity: newTotalQuantity,
          variants: product.variants.map(v => ({
            ...v,
            quantity: quantities[v.id],
          })),
          sizeBreakdown: product.variants.reduce((acc, v) => {
            if (v.size) {
              acc[v.size] = quantities[v.id];
            }
            return acc;
          }, {} as Record<string, number>),
        };
        onProductUpdated(updatedProduct);
      }
    } catch (err: any) {
      console.error('Error saving:', err);
      notifications.show({
        title: 'Erreur de sauvegarde',
        message: err.message || 'Une erreur est survenue',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  // Ordre des tailles (XXXS à 5XL)
  const sizeOrder = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'];

  // Extraire la valeur d'une option par son nom
  const getOptionValue = (variant: typeof product.variants[0], optionName: string) => {
    if (variant.options) {
      const opt = variant.options.find(o => o.name === optionName);
      return opt?.value || '';
    }
    return '';
  };

  // Vérifier si une option est une taille
  const isSizeOption = (optionName: string) => {
    return optionName.toLowerCase().includes('taille') || optionName.toLowerCase().includes('size');
  };

  // Comparer deux valeurs (avec tri spécial pour les tailles)
  const compareValues = (a: string, b: string, optionName: string) => {
    if (isSizeOption(optionName)) {
      const aIndex = sizeOrder.indexOf(a);
      const bIndex = sizeOrder.indexOf(b);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
    }
    return a.localeCompare(b, 'fr');
  };

  // Formater le nom de la variante selon l'ordre de tri (retourne un tableau de segments avec couleur optionnelle)
  const getVariantDisplayParts = (variant: typeof product.variants[0]) => {
    if (sortOrder.length === 0) {
      return [{ text: variant.title || 'Default', color: null }];
    }
    
    // Construire les parties avec les valeurs des options dans l'ordre de tri
    const parts: { text: string; color: string | null }[] = [];
    
    for (const optName of sortOrder) {
      const value = getOptionValue(variant, optName);
      if (value) {
        const color = isColorOption(optName) ? getColorHex(value) : null;
        parts.push({ text: value, color });
      }
    }
    
    return parts.length > 0 ? parts : [{ text: variant.title || 'Default', color: null }];
  };

  // Trier les variantes selon l'ordre de priorité défini
  const sortedVariants = useMemo(() => {
    return [...product.variants].sort((a, b) => {
      // Parcourir les options dans l'ordre de priorité
      for (const optName of sortOrder) {
        const aVal = getOptionValue(a, optName);
        const bVal = getOptionValue(b, optName);
        const compare = compareValues(aVal, bVal, optName);
        if (compare !== 0) return compare;
      }
      return 0;
    });
  }, [product.variants, sortOrder]);

  return (
    <div className={styles.container}>
      {/* Header avec bouton retour */}
      <div className={styles.header}>
        <Button
          variant="subtle"
          color="gray"
          leftSection={<IconArrowLeft size={18} />}
          onClick={onBack}
          className={styles.backButton}
        >
          Retour à l'inventaire
        </Button>
         {/* Image */}
        <div className={styles.imageSection}>
          {product.image ? (
            <Image
              src={product.image}
              alt={product.imageAlt || product.title}
              className={styles.productImage}
              fit="contain"
            />
          ) : (
            <div className={styles.noImage}>
              <IconPhoto size={48} stroke={1.5} />
            </div>
          )}
        </div>
        {/* Title */}
        <Title order={2} className={styles.productTitle}>
        {product.title}
        </Title>
        {/* handle */}
        {product.handle && (
          <Text size="sm" c="dimmed" className={styles.productHandle}>
            {product.handle}
          </Text>
        )}

        {/* Bouton Sauvegarder */}
        <div className={styles.saveButtonContainer}>
          <Button
            color="green"
            leftSection={saving ? <Loader size={16} color="white" /> : <IconDeviceFloppy size={18} />}
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className={styles.saveButton}
          >
            {saving ? 'Sauvegarde...' : 'Sauvegarder'}
          </Button>
        </div>
      </div>

      {/* Contenu principal */}
      <div className={styles.content}>
        {/* Section info produit */}
        <div className={styles.productInfo}>

          {/* Informations */}
          <div className={styles.infoSection}>

            {/* Stock total */}
            <div className={styles.stockTotal}>
              <Text size="sm" fw={500} className={styles.stockLabel}>
                Stock total : {locationName && `${locationName}`}
              </Text>
              <Badge
                size="xl"
                color={newTotalQuantity > 0 ? 'green' : 'red'}
                variant="light"
                className={styles.stockBadge}
              >
                {newTotalQuantity} unité{newTotalQuantity > 1 ? 's' : ''}
                {hasChanges && ` (${newTotalQuantity - product.totalQuantity >= 0 ? '+' : ''}${newTotalQuantity - product.totalQuantity})`}
              </Badge>
            </div>

            {/* Répartition par taille */}
            {Object.keys(product.sizeBreakdown).length > 0 && (
              <div className={styles.sizeBreakdown}>
                <Group gap="xs" className={styles.sizeBreakdownBadges}>
                  {Object.entries(product.sizeBreakdown).map(([size, qty]) => (
                    <Badge
                      key={size}
                      variant="outline"
                      color={qty > 0 ? 'gray' : 'red'}
                      className={`${styles.sizeBadge} ${qty > 0 ? styles.inStock : styles.outOfStock}`}
                    >
                      {size}: {qty}
                    </Badge>
                  ))}
                </Group>
              </div>
            )}
          </div>
        </div>

        {/* Tableau des variantes */}
        <div className={styles.variantsSection}>
          <Group justify="space-between" align="center" mb="md">
            <Text size="sm" fw={600} className={styles.variantsTitle}>
              Détail des variantes ({sortedVariants.length})
            </Text>
<SortOptionsBar
              options={sortOrder}
              onReorder={setSortOrder}
            />
          </Group>
          
          <Table striped highlightOnHover className={styles.variantsTable}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Variante</Table.Th>
                <Table.Th>SKU</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Coût</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Quantité</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sortedVariants.map((variant) => (
                <Table.Tr key={variant.id}>
                  <Table.Td className={styles.variantName}>
                    <span className={styles.variantNameContent}>
                      {getVariantDisplayParts(variant).map((part, idx, arr) => (
                        <span key={idx}>
                          {part.color && (
                            <span 
                              className={styles.colorDot}
                              style={{ 
                                background: part.color,
                                border: part.color === '#FFFFFF' ? '1px solid #ccc' : 'none'
                              }}
                            />
                          )}
                          {part.text}
                          {idx < arr.length - 1 && ' / '}
                        </span>
                      ))}
                    </span>
                  </Table.Td>
                  <Table.Td className={styles.variantSku}>
                    {variant.sku || '-'}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text size="sm" fw={500} c={(variant.cost || 0) > 0 ? 'blue' : 'orange'}>
                      {(variant.cost || 0) > 0 ? `${(variant.cost || 0).toFixed(2)} €` : '-'}
                    </Text>
                  </Table.Td>
                  <Table.Td className={styles.variantQuantity}>
                    <Group gap="xs" justify="flex-end" className={styles.quantityControls}>
                      {quantities[variant.id] !== variant.quantity && (
                        <Badge
                          size="xs"
                          color={quantities[variant.id] > variant.quantity ? 'green' : 'red'}
                          variant="light"
                          className={styles.changeBadge}
                        >
                          {quantities[variant.id] > variant.quantity ? '+' : ''}{quantities[variant.id] - variant.quantity}
                        </Badge>
                      )}
                      <ActionIcon
                        variant="light"
                        color="red"
                        size="sm"
                        onClick={() => handleDecrement(variant.id)}
                        disabled={quantities[variant.id] <= 0}
                        className={styles.quantityButton}
                      >
                        <IconMinus size={14} />
                      </ActionIcon>
                      <NumberInput
                        value={quantities[variant.id]}
                        onChange={(val) => handleQuantityChange(variant.id, typeof val === 'number' ? val : 0)}
                        min={0}
                        hideControls
                        className={styles.quantityInput}
                        styles={{ input: { width: 60, textAlign: 'center' } }}
                      />
                      <ActionIcon
                        variant="light"
                        color="green"
                        size="sm"
                        onClick={() => handleIncrement(variant.id)}
                        className={styles.quantityButton}
                      >
                        <IconPlus size={14} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
      </div>
    </div>
  );
}
