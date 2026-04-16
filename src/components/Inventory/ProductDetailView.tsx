'use client';

import { useState, useMemo } from 'react';
import { Button, Text, Badge, Group, Stack, Table, Image, NumberInput, ActionIcon, Loader, Modal, Paper } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconArrowLeft, IconPhoto, IconPlus, IconMinus, IconDeviceFloppy, IconTrash, IconRefresh, IconArchive, IconUpload } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useTerminalStream } from '@/hooks/useTerminalStream';
import { ProductData } from './ProductCard';
import { SortOptionsBar } from './SortOptionsBar';
import { StatusBadge } from '@/components/StatusBadge';
import { MetaChip } from '@/components/MetaChip';
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
  // État local pour les coûts et prix modifiés
  const [costs, setCosts] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    product.variants.forEach(v => {
      initial[v.id] = v.cost || 0;
    });
    return initial;
  });
  const [prices, setPrices] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    product.variants.forEach(v => {
      initial[v.id] = v.price || 0;
    });
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [resetModalOpened, { open: openResetModal, close: closeResetModal }] = useDisclosure(false);
  const [deleteGroup, setDeleteGroup] = useState<{ label: string; ids: string[] } | null>(null);
  const [archiveModalOpened, { open: openArchiveModal, close: closeArchiveModal }] = useDisclosure(false);
  const [archiving, setArchiving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushModalOpened, { open: openPushModal, close: closePushModal }] = useDisclosure(false);
  const { streamFromUrl } = useTerminalStream();

  const isLocalProduct = product.status === 'LOCAL' || product.status === 'DRAFT';
  const [fixingStates, setFixingStates] = useState(false);
  const mismatchedVariants = isLocalProduct ? product.variants.filter(v => v.shopifyActive !== false) : [];

  // Variantes locales groupées par première option commune
  const localVariantGroups = useMemo(() => {
    const locals = product.variants.filter(v => v.shopifyActive === false);
    if (locals.length === 0) return [];

    const groups: Record<string, typeof locals> = {};
    for (const v of locals) {
      const key = v.options?.[0]?.value || v.title || 'Autre';
      if (!groups[key]) groups[key] = [];
      groups[key].push(v);
    }

    return Object.entries(groups).map(([label, variants]) => ({
      label,
      variants,
      totalQuantity: variants.reduce((sum, v) => sum + Math.max(0, v.quantity), 0),
      subabaseIds: variants.map(v => v.supabaseId).filter(Boolean) as string[],
      subValues: variants
        .map(v => v.options?.slice(1).map(o => o.value).join(' / ') || '')
        .filter(Boolean),
    }));
  }, [product.variants]);

  // Supprimer un groupe de variantes locales
  const handleDeleteVariants = async () => {
    if (!deleteGroup || !shopId) return;

    try {
      for (const variantId of deleteGroup.ids) {
        const params = new URLSearchParams({ variantId, shopId });
        const response = await fetch(`/api/inventory/delete-variant?${params}`, {
          method: 'DELETE',
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Erreur de suppression');
      }

      // Retirer les variantes du state
      const deletedIds = new Set(deleteGroup.ids);
      if (onProductUpdated) {
        const updatedVariants = product.variants.filter(v => !deletedIds.has(v.supabaseId || ''));
        const updatedProduct: ProductData = {
          ...product,
          variants: updatedVariants,
          totalQuantity: updatedVariants.reduce((sum, v) => sum + Math.max(0, v.quantity), 0),
          sizeBreakdown: updatedVariants.reduce((acc, v) => {
            if (v.size) acc[v.size] = (acc[v.size] || 0) + Math.max(0, v.quantity);
            return acc;
          }, {} as Record<string, number>),
        };
        onProductUpdated(updatedProduct);
      }

      setQuantities(prev => {
        const next = { ...prev };
        for (const v of product.variants) {
          if (deletedIds.has(v.supabaseId || '')) delete next[v.id];
        }
        return next;
      });

      notifications.show({
        title: 'Variantes supprimées',
        message: `${deleteGroup.ids.length} variante${deleteGroup.ids.length > 1 ? 's' : ''} supprimée${deleteGroup.ids.length > 1 ? 's' : ''}`,
        color: 'moss',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Une erreur est survenue';
      notifications.show({
        title: 'Erreur de suppression',
        message,
        color: 'rust',
      });
    } finally {
      setDeleteGroup(null);
    }
  };

  // Archiver le produit (local/draft → archived)
  const handleArchive = async () => {
    if (!shopId || !product.supabaseId) return;
    setArchiving(true);
    try {
      const params = new URLSearchParams({
        productId: product.supabaseId,
        shopId,
        action: 'archive',
      });
      const response = await fetch(`/api/inventory/archive?${params}`, { method: 'PATCH' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Erreur');
      }
      notifications.show({
        title: 'Produit archivé',
        message: `${product.title} a été déplacé dans les archives`,
        color: 'moss',
      });
      closeArchiveModal();
      onBack();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur';
      notifications.show({ title: 'Erreur', message, color: 'rust' });
    } finally {
      setArchiving(false);
    }
  };

  // Remettre toutes les quantités à zéro
  const handleResetStock = () => {
    const zeroed: Record<string, number> = {};
    product.variants.forEach(v => {
      zeroed[v.id] = 0;
    });
    setQuantities(zeroed);
    closeResetModal();
  };

  // Corriger l'état des variantes (forcer locale pour les produits locaux)
  const handleFixVariantStates = async () => {
    if (!shopId || !product.supabaseId) return;
    setFixingStates(true);
    try {
      const variantIds = mismatchedVariants.map(v => v.supabaseId).filter(Boolean);
      if (variantIds.length === 0) return;

      const res = await fetch('/api/inventory/fix-variant-states', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.supabaseId, shopId }),
      });

      if (!res.ok) throw new Error('Erreur');

      // Mettre à jour le produit localement
      if (onProductUpdated) {
        onProductUpdated({
          ...product,
          variants: product.variants.map(v => ({ ...v, shopifyActive: false })),
        });
      }

      notifications.show({
        title: 'Variantes corrigées',
        message: `${variantIds.length} variante(s) passée(s) en locale`,
        color: 'moss',
      });
    } catch {
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de corriger les variantes',
        color: 'rust',
      });
    } finally {
      setFixingStates(false);
    }
  };

  // Pousser le stock local vers Shopify
  const handlePushToShopify = async () => {
    if (!shopId || !locationId || !product.supabaseId) return;
    closePushModal();
    setPushing(true);

    const params = new URLSearchParams({ shopId, locationId, productId: product.supabaseId });

    const success = await streamFromUrl(`/api/inventory/push-product?${params}`, {
      title: `Push: ${product.title}`,
    });

    if (success && onProductUpdated) {
      // Le backend a déjà mis à jour la DB : variantes → shopify_active=true, produit → active
      onProductUpdated({
        ...product,
        status: 'ACTIVE',
        variants: product.variants.map(v => ({ ...v, shopifyActive: true })),
      });
    } else if (!success) {
      notifications.show({
        title: 'Erreur',
        message: 'Le push vers Shopify a échoué',
        color: 'rust',
      });
    }
    setPushing(false);
  };

  // Synchroniser ce produit depuis Shopify via le terminal stream
  const handleSyncProduct = async () => {
    if (!shopId) return;

    const shopifyProductId = product.id.replace('gid://shopify/Product/', '');
    const params = new URLSearchParams({ shopId, productId: shopifyProductId });
    if (locationId) params.set('locationId', locationId);

    setSyncing(true);
    const success = await streamFromUrl(`/api/inventory/sync-product?${params}`, {
      title: `Sync: ${product.title}`,
      onComplete: (data) => {
        if (data?.product && onProductUpdated) {
          const updatedProduct = data.product as ProductData;
          onProductUpdated(updatedProduct);

          // Mettre à jour les quantités locales
          const newQtys: Record<string, number> = {};
          updatedProduct.variants.forEach(v => {
            newQtys[v.id] = v.quantity;
          });
          setQuantities(newQtys);
        }
      },
    });

    if (!success) {
      notifications.show({
        title: 'Erreur de synchronisation',
        message: 'La synchronisation a échoué',
        color: 'rust',
      });
    }
    setSyncing(false);
  };

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
    return product.variants.some(v =>
      quantities[v.id] !== v.quantity ||
      costs[v.id] !== (v.cost || 0) ||
      prices[v.id] !== (v.price || 0)
    );
  }, [product.variants, quantities, costs, prices]);

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
        color: 'rust',
      });
      return;
    }

    setSaving(true);
    try {
      // Préparer les modifications (seulement les variantes modifiées)
      const changes = product.variants
        .filter(v =>
          quantities[v.id] !== v.quantity ||
          costs[v.id] !== (v.cost || 0) ||
          prices[v.id] !== (v.price || 0)
        )
        .map(v => ({
          variantId: v.id,
          quantity: quantities[v.id],
          cost: costs[v.id],
          price: prices[v.id],
        }));

      if (changes.length === 0) {
        notifications.show({
          title: 'Aucune modification',
          message: 'Aucun stock n\'a été modifié',
          color: 'clay',
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
        color: 'moss',
      });

      // Mettre à jour le produit parent si callback fourni
      if (onProductUpdated) {
        const updatedProduct: ProductData = {
          ...product,
          totalQuantity: Object.values(quantities).reduce((sum, qty) => sum + Math.max(0, qty), 0),
          variants: product.variants.map(v => ({
            ...v,
            quantity: quantities[v.id],
            cost: costs[v.id],
            price: prices[v.id],
          })),
          sizeBreakdown: product.variants.reduce((acc, v) => {
            if (v.size) {
              acc[v.size] = (acc[v.size] || 0) + Math.max(0, quantities[v.id]);
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
        color: 'rust',
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
          color="slate"
          leftSection={<IconArrowLeft size={18} />}
          onClick={onBack}
          className={styles.backButton}
        >
          Retour à l&apos;inventaire
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
              <IconPhoto size={24} stroke={1.5} />
            </div>
          )}
        </div>
        {/* Title */}
        <h2 className={styles.productTitle}>{product.title}</h2>
        {/* handle */}
        {product.handle && (
          <span className={styles.productHandle}>{product.handle}</span>
        )}

        {/* Boutons d'action */}
        <div className={styles.saveButtonContainer}>
          <Group gap="xs">
            <Button
              variant="light"
              color="slate"
              leftSection={syncing ? <Loader size={14} color="slate" /> : <IconRefresh size={16} />}
              onClick={handleSyncProduct}
              disabled={syncing || saving}
              size="sm"
            >
              {syncing ? 'Import…' : 'Importer de Shopify'}
            </Button>
            <Button
              variant="light"
              color="moss"
              leftSection={pushing ? <Loader size={14} color="moss" /> : <IconUpload size={16} />}
              onClick={openPushModal}
              disabled={saving || syncing || pushing}
              size="sm"
            >
              {pushing ? 'Push…' : 'Pousser vers Shopify'}
            </Button>
            {isLocalProduct && (
              <Button
                variant="light"
                color="clay.5"
                leftSection={<IconArchive size={16} />}
                onClick={openArchiveModal}
                disabled={saving || syncing}
                size="sm"
              >
                Archiver
              </Button>
            )}
            <Button
              variant="light"
              color="rust"
              leftSection={<IconTrash size={16} />}
              onClick={openResetModal}
              disabled={saving || syncing || newTotalQuantity === 0}
              size="sm"
            >
              Remettre à zéro
            </Button>
            <Button
              color="slate.8"
              leftSection={saving ? <Loader size={16} color="white" /> : <IconDeviceFloppy size={18} />}
              onClick={handleSave}
              disabled={!hasChanges || saving || syncing}
              className={styles.saveButton}
            >
              {saving ? 'Sauvegarde…' : 'Sauvegarder'}
            </Button>
          </Group>
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
              <span className={styles.stockLabel}>
                Stock total{locationName ? ` · ${locationName}` : ''}
              </span>
              <Badge
                size="xl"
                color={newTotalQuantity > 0 ? 'moss' : 'rust'}
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
                <Group gap={6} className={styles.sizeBreakdownBadges}>
                  {Object.entries(product.sizeBreakdown).map(([size, qty]) => (
                    <Badge
                      key={size}
                      variant="outline"
                      color={qty > 0 ? 'slate' : 'rust'}
                      className={styles.sizeBadge}
                    >
                      {size}: {qty}
                    </Badge>
                  ))}
                </Group>
              </div>
            )}
          </div>
        </div>

        {/* Alerte : variantes mal marquées */}
        {mismatchedVariants.length > 0 && (
          <Paper radius="md" p="sm" mb="md" className={styles.alertCard}>
            <Group justify="space-between" align="center">
              <Text size="sm" c="clay.7" fw={500}>
                {mismatchedVariants.length} variante{mismatchedVariants.length > 1 ? 's' : ''} marquée{mismatchedVariants.length > 1 ? 's' : ''} Shopify alors que le produit est local
              </Text>
              <Button
                size="xs"
                variant="light"
                color="clay.5"
                leftSection={<IconRefresh size={14} />}
                onClick={handleFixVariantStates}
                loading={fixingStates}
              >
                Corriger
              </Button>
            </Group>
          </Paper>
        )}

        {/* Bloc variantes locales (groupées) */}
        {localVariantGroups.length > 0 && (
          <Paper radius="md" p="sm" mb="md" className={styles.localGroupCard}>
            <Group gap="xs" mb="xs">
              <span className={styles.localGroupLabel}>Variantes locales</span>
              <StatusBadge variant="slate">
                {product.variants.filter(v => v.shopifyActive === false).reduce((sum, v) => sum + v.quantity, 0)}/{product.variants.filter(v => v.shopifyActive === false).length}
              </StatusBadge>
            </Group>
            <Stack gap={6}>
              {localVariantGroups.map((group) => (
                <Group key={group.label} justify="space-between" gap="xs">
                  <Group gap="xs" style={{ flex: 1, minWidth: 0 }}>
                    <Text size="sm" fw={500} c="slate.8">{group.label}</Text>
                    <StatusBadge variant="slate">
                      {group.totalQuantity}/{group.variants.length}
                    </StatusBadge>
                    {group.subValues.length > 0 && (
                      <Text size="xs" c="slate.5" truncate>
                        {group.subValues.join(', ')}
                      </Text>
                    )}
                  </Group>
                  <ActionIcon
                    variant="subtle"
                    color="rust"
                    size="sm"
                    onClick={() => setDeleteGroup({ label: group.label, ids: group.subabaseIds })}
                    aria-label="Supprimer le groupe"
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          </Paper>
        )}

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
                <Table.Th style={{ textAlign: 'center' }}>État</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Coût</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Prix</Table.Th>
                <Table.Th>Métachamps</Table.Th>
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
                                boxShadow: part.color.toUpperCase() === '#FFFFFF'
                                  ? 'inset 0 0 0 1px var(--divider-strong)'
                                  : undefined,
                              }}
                            />
                          )}
                          {part.text}
                          {idx < arr.length - 1 && ' / '}
                        </span>
                      ))}
                    </span>
                  </Table.Td>
                  <Table.Td>
                    <span className={styles.variantSku}>{variant.sku || '-'}</span>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'center' }}>
                    <StatusBadge variant={variant.shopifyActive === false ? 'clay' : 'moss'}>
                      {variant.shopifyActive === false ? 'Locale' : 'Shopify'}
                    </StatusBadge>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <NumberInput
                      value={costs[variant.id] || 0}
                      onChange={(val) => setCosts(prev => ({ ...prev, [variant.id]: typeof val === 'number' ? val : 0 }))}
                      min={0}
                      decimalScale={2}
                      fixedDecimalScale
                      hideControls
                      suffix=" €"
                      styles={{ input: { width: 90, textAlign: 'right', fontSize: '0.85rem' } }}
                    />
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <NumberInput
                      value={prices[variant.id] || 0}
                      onChange={(val) => setPrices(prev => ({ ...prev, [variant.id]: typeof val === 'number' ? val : 0 }))}
                      min={0}
                      decimalScale={2}
                      fixedDecimalScale
                      hideControls
                      suffix=" €"
                      styles={{ input: { width: 90, textAlign: 'right', fontSize: '0.85rem' } }}
                    />
                  </Table.Td>
                  <Table.Td>
                    {variant.metafields && variant.metafields.length > 0 ? (
                      <Group gap={4} wrap="wrap">
                        {variant.metafields.map((mf, i) => (
                          <MetaChip key={i} keyName={mf.key} value={mf.value} />
                        ))}
                      </Group>
                    ) : (
                      <Text size="xs" c="slate.5">—</Text>
                    )}
                  </Table.Td>
                  <Table.Td className={styles.variantQuantity}>
                    <Group gap="xs" justify="flex-end" className={styles.quantityControls}>
                      {quantities[variant.id] !== variant.quantity && (
                        <Badge
                          size="xs"
                          color={quantities[variant.id] > variant.quantity ? 'moss' : 'rust'}
                          variant="light"
                          className={styles.changeBadge}
                        >
                          {quantities[variant.id] > variant.quantity ? '+' : ''}{quantities[variant.id] - variant.quantity}
                        </Badge>
                      )}
                      <ActionIcon
                        variant="light"
                        color="rust"
                        size="sm"
                        onClick={() => handleDecrement(variant.id)}
                        disabled={quantities[variant.id] <= 0}
                        className={styles.quantityButton}
                        aria-label="Décrémenter"
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
                        color="moss"
                        size="sm"
                        onClick={() => handleIncrement(variant.id)}
                        className={styles.quantityButton}
                        aria-label="Incrémenter"
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

      {/* Modal de confirmation reset */}
      <Modal
        opened={resetModalOpened}
        onClose={closeResetModal}
        radius="lg"
        title={
          <span className={styles.modalTitle}>
            <IconTrash size={18} />
            Remettre <em>à zéro</em>
          </span>
        }
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="slate.7">
            Toutes les quantités de <Text span fw={600} c="slate.8">{product.title}</Text> seront mises à zéro.
          </Text>
          <Text size="xs" c="slate.5" fs="italic">
            Les modifications ne seront effectives qu&apos;après avoir cliqué sur Sauvegarder.
          </Text>
          <Group justify="flex-end" gap="sm" mt="md">
            <Button variant="default" color="slate" onClick={closeResetModal}>
              Annuler
            </Button>
            <Button color="rust" onClick={handleResetStock}>
              Remettre à zéro
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Modal de confirmation suppression variantes locales */}
      <Modal
        opened={!!deleteGroup}
        onClose={() => setDeleteGroup(null)}
        radius="lg"
        title={
          <span className={styles.modalTitle}>
            <IconTrash size={18} />
            Supprimer <em>{deleteGroup?.ids.length === 1 ? 'la variante' : 'les variantes'}</em>
          </span>
        }
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="slate.7">
            Supprimer définitivement <Text span fw={600} c="slate.8">{deleteGroup?.label}</Text>{' '}
            ({deleteGroup?.ids.length} variante{(deleteGroup?.ids.length || 0) > 1 ? 's' : ''}) ?
          </Text>
          <Text size="xs" c="slate.5" fs="italic">
            Le stock associé sera perdu. Cette action est irréversible.
          </Text>
          <Group justify="flex-end" gap="sm" mt="md">
            <Button variant="default" color="slate" onClick={() => setDeleteGroup(null)}>
              Annuler
            </Button>
            <Button color="rust" onClick={handleDeleteVariants}>
              Supprimer
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Modal de confirmation archivage */}
      <Modal
        opened={archiveModalOpened}
        onClose={closeArchiveModal}
        radius="lg"
        title={
          <span className={styles.modalTitle}>
            <IconArchive size={18} />
            Archiver <em>le produit</em>
          </span>
        }
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="slate.7">
            Déplacer <Text span fw={600} c="slate.8">{product.title}</Text> dans les archives ?
          </Text>
          <Text size="xs" c="slate.5" fs="italic">
            Le produit ne sera plus visible dans l&apos;inventaire. Vous pourrez le restaurer depuis la page Archives.
          </Text>
          <Group justify="flex-end" gap="sm" mt="md">
            <Button variant="default" color="slate" onClick={closeArchiveModal}>
              Annuler
            </Button>
            <Button color="clay.5" onClick={handleArchive} loading={archiving}>
              Archiver
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Modal de confirmation push vers Shopify */}
      <Modal
        opened={pushModalOpened}
        onClose={closePushModal}
        radius="lg"
        title={
          <span className={styles.modalTitle}>
            <IconUpload size={18} />
            Pousser <em>vers Shopify</em>
          </span>
        }
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="slate.7">
            Envoyer le stock de <Text span fw={600} c="slate.8">{product.title}</Text> vers Shopify ?
          </Text>
          <Text size="xs" c="slate.5" fs="italic">
            Les quantités d&apos;Ivy remplaceront celles de Shopify. Seules les variantes existantes sur Shopify seront mises à jour.
          </Text>
          <Group justify="flex-end" gap="sm" mt="md">
            <Button variant="default" color="slate" onClick={closePushModal}>
              Annuler
            </Button>
            <Button color="moss" onClick={handlePushToShopify}>
              Pousser vers Shopify
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
