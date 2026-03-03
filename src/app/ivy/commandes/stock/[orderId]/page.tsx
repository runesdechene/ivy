'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Title, Text, Paper, Table, Button, Group, Badge, ActionIcon, Modal, NumberInput, Checkbox, Loader, Center, Stack, Textarea, Divider, Progress, TextInput, SimpleGrid, Tooltip } from '@mantine/core';
import { IconArrowLeft, IconPlus, IconTrash, IconDeviceFloppy, IconCheck, IconLock, IconSearch, IconPackage, IconMinus, IconRefresh, IconTag, IconPrinter, IconChecklist } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useDisclosure } from '@mantine/hooks';
import { useShop } from '@/context/ShopContext';
import { useLocation } from '@/context/LocationContext';
import { ProductCard, ProductData } from '@/components/Inventory';
import { SortOptionsBar } from '@/components/Inventory/SortOptionsBar';
import { getColorHex, isColorOption, loadColorMappingsFromSupabase, areColorMappingsLoaded } from '@/utils/color-transformer';
import { useTerminalStream } from '@/hooks/useTerminalStream';
import styles from './order-detail.module.scss';

// Ordre des tailles pour le tri
const SIZE_ORDER = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'];

function getSizeIndex(size: string | null | undefined): number {
  if (!size) return 999;
  const upperSize = size.toUpperCase();
  const index = SIZE_ORDER.indexOf(upperSize);
  return index === -1 ? 999 : index;
}

interface OrderItem {
  id: string;
  variant_id: string | null;
  product_title: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  is_validated: boolean;
  validated_at: string | null;
  metafields?: Record<string, string>;
  stock_status: 'added' | 'failed' | null;
  stock_error: string | null;
  stock_added_at: string | null;
}

interface StockResult {
  added: number;
  failed: number;
  skipped: number;
  errors: Array<{ sku: string; variant_title: string; error: string }>;
}

interface SupplierOrder {
  id: string;
  order_number: string;
  status: 'draft' | 'requested' | 'produced' | 'completed';
  note: string | null;
  subtotal: number;
  balance_adjustment: number;
  total_ht: number;
  total_ttc: number;
  created_at: string;
  closed_at: string | null;
}

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.orderId as string;
  const { currentShop } = useShop();
  const { currentLocation } = useLocation();
  const { streamFromUrl } = useTerminalStream();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [order, setOrder] = useState<SupplierOrder | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [note, setNote] = useState('');
  const [balanceAdjustment, setBalanceAdjustment] = useState(0);
  
  // Modal ajout produits
  const [addModalOpened, { open: openAddModal, close: closeAddModal }] = useDisclosure(false);
  const [products, setProducts] = useState<ProductData[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVariants, setSelectedVariants] = useState<Record<string, number>>({});
  const [skuFilter, setSkuFilter] = useState<string | null>(null);
  const [modalSortOrder, setModalSortOrder] = useState<string[]>([]);

  // Tri des articles dans la liste principale (drag & drop)
  const [sortOrder, setSortOrder] = useState<string[]>(['Nom', 'Couleur', 'Taille']);
  

  // Charger la commande et ses articles
  const fetchOrder = useCallback(async () => {
    if (!currentShop || !orderId) return;
    
    setLoading(true);
    try {
      const response = await fetch(`/api/suppliers/orders/${orderId}?shopId=${currentShop.id}`);
      if (response.ok) {
        const data = await response.json();
        setOrder(data.order);
        setItems(data.items || []);
        setNote(data.order.note || '');
        setBalanceAdjustment(data.order.balance_adjustment || 0);
      } else {
        throw new Error('Order not found');
      }
    } catch (err) {
      console.error('Error fetching order:', err);
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de charger la commande',
        color: 'red',
      });
      router.push('/ivy/commandes/stock');
    } finally {
      setLoading(false);
    }
  }, [currentShop, orderId, router]);

  useEffect(() => {
    fetchOrder();
    if (currentShop && !areColorMappingsLoaded()) {
      loadColorMappingsFromSupabase(currentShop.id);
    }
  }, [fetchOrder, currentShop]);

  // Charger les produits pour l'ajout (avec recherche)
  const fetchProducts = async (query: string) => {
    if (!currentShop || query.length < 3) {
      setProducts([]);
      return;
    }
    
    setLoadingProducts(true);
    try {
      const params = new URLSearchParams({ 
        shopId: currentShop.id,
        search: query 
      });
      if (currentLocation) {
        params.append('locationId', currentLocation.id);
      }
      const response = await fetch(`/api/products?${params}`);
      if (response.ok) {
        const data = await response.json();
        setProducts(data.products || []);
      }
    } catch (err) {
      console.error('Error fetching products:', err);
    } finally {
      setLoadingProducts(false);
    }
  };

  // Ouvrir le modal d'ajout
  const handleOpenAddModal = () => {
    setProducts([]);
    setSelectedVariants({});
    setSearchQuery('');
    setSkuFilter(null);
    setModalSortOrder([]);
    openAddModal();
  };

  // Extraire les préfixes SKU uniques des produits chargés
  const skuPrefixes = useMemo(() => {
    const prefixCounts = new Map<string, Set<string>>();
    
    products.forEach(product => {
      product.variants.forEach(variant => {
        if (variant.sku) {
          const match = variant.sku.match(/^([A-Za-z]+)/);
          if (match) {
            const prefix = match[1].toUpperCase();
            if (!prefixCounts.has(prefix)) {
              prefixCounts.set(prefix, new Set());
            }
            prefixCounts.get(prefix)!.add(product.id);
          }
        }
      });
    });
    
    return Array.from(prefixCounts.entries())
      .map(([prefix, productIds]) => ({ prefix, count: productIds.size }))
      .sort((a, b) => a.prefix.localeCompare(b.prefix));
  }, [products]);

  // Détecter les options de tous les produits affichés et initialiser le tri
  const modalProductOptions = useMemo(() => {
    const optionNames: string[] = [];
    for (const product of products) {
      for (const variant of product.variants) {
        if (variant.options) {
          for (const opt of variant.options) {
            if (opt.name && !optionNames.includes(opt.name)) {
              optionNames.push(opt.name);
            }
          }
        }
      }
    }
    // Taille en premier par défaut
    const sizeIndex = optionNames.findIndex(opt =>
      opt.toLowerCase().includes('taille') || opt.toLowerCase().includes('size')
    );
    if (sizeIndex > 0) {
      const [sizeOpt] = optionNames.splice(sizeIndex, 1);
      optionNames.unshift(sizeOpt);
    }
    return optionNames;
  }, [products]);

  // Synchroniser le sort order quand les options changent
  useEffect(() => {
    if (modalProductOptions.length > 0 && modalSortOrder.length === 0) {
      setModalSortOrder(modalProductOptions);
    }
  }, [modalProductOptions, modalSortOrder.length]);

  // Comparer deux valeurs d'option (tri spécial pour les tailles)
  const compareOptionValues = useCallback((a: string, b: string, optionName: string) => {
    const isSize = optionName.toLowerCase().includes('taille') || optionName.toLowerCase().includes('size');
    if (isSize) {
      const aIndex = SIZE_ORDER.indexOf(a.toUpperCase());
      const bIndex = SIZE_ORDER.indexOf(b.toUpperCase());
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
    }
    return a.localeCompare(b, 'fr');
  }, []);

  // Filtrer par préfixe SKU et trier les variantes selon l'ordre choisi
  const displayedProducts = useMemo(() => {
    let result = [...products];

    if (skuFilter) {
      result = result.filter(product =>
        product.variants.some(v => v.sku?.toUpperCase().startsWith(skuFilter))
      );
    }

    const sortKeys = modalSortOrder.length > 0 ? modalSortOrder : modalProductOptions;

    result = result.map(product => ({
      ...product,
      variants: [...product.variants].sort((a, b) => {
        for (const optName of sortKeys) {
          const aVal = a.options?.find(o => o.name === optName)?.value || '';
          const bVal = b.options?.find(o => o.name === optName)?.value || '';
          const cmp = compareOptionValues(aVal, bVal, optName);
          if (cmp !== 0) return cmp;
        }
        return 0;
      })
    }));

    return result;
  }, [products, skuFilter, modalSortOrder, modalProductOptions, compareOptionValues]);

  // Rechercher les produits quand la query change
  useEffect(() => {
    if (!addModalOpened) return;
    
    const timeoutId = setTimeout(() => {
      if (searchQuery.length >= 3) {
        fetchProducts(searchQuery);
      } else {
        setProducts([]);
      }
    }, 300); // Debounce de 300ms
    
    return () => clearTimeout(timeoutId);
  }, [searchQuery, addModalOpened, currentShop, currentLocation]);


  // Ajouter les variantes sélectionnées
  const addSelectedVariants = async () => {
    if (!currentShop || !orderId) return;
    
    const variantsToAdd = Object.entries(selectedVariants)
      .filter(([_, qty]) => qty > 0)
      .map(([variantId, quantity]) => {
        // Trouver le produit et la variante
        for (const product of products) {
          const variant = product.variants.find((v: any) => v.id === variantId);
          if (variant) {
            return {
              variant_id: variant.supabaseId, // Utiliser l'UUID Supabase, pas l'ID Shopify
              product_title: product.title,
              variant_title: variant.title,
              sku: variant.sku,
              quantity,
            };
          }
        }
        return null;
      })
      .filter(Boolean);

    if (variantsToAdd.length === 0) {
      notifications.show({
        title: 'Attention',
        message: 'Sélectionnez au moins une variante',
        color: 'orange',
      });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/suppliers/orders/${orderId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: currentShop.id,
          items: variantsToAdd,
        }),
      });

      if (response.ok) {
        notifications.show({
          title: 'Succès',
          message: `${variantsToAdd.length} article(s) ajouté(s)`,
          color: 'green',
        });
        closeAddModal();
        fetchOrder();
      }
    } catch (err) {
      console.error('Error adding items:', err);
      notifications.show({
        title: 'Erreur',
        message: 'Impossible d\'ajouter les articles',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  // Supprimer un article
  const deleteItem = async (itemId: string) => {
    if (!currentShop) return;
    
    try {
      const response = await fetch(`/api/suppliers/orders/${orderId}/items?itemId=${itemId}&shopId=${currentShop.id}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        setItems(prev => prev.filter(i => i.id !== itemId));
        notifications.show({
          title: 'Succès',
          message: 'Article supprimé',
          color: 'green',
        });
      }
    } catch (err) {
      console.error('Error deleting item:', err);
    }
  };

  // Valider/Dévalider un article
  const toggleValidation = async (itemId: string, isValidated: boolean) => {
    if (!currentShop) return;
    
    try {
      const response = await fetch(`/api/suppliers/orders/${orderId}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: currentShop.id,
          itemId,
          is_validated: isValidated,
        }),
      });
      
      if (response.ok) {
        setItems(prev => prev.map(i => 
          i.id === itemId 
            ? { ...i, is_validated: isValidated, validated_at: isValidated ? new Date().toISOString() : null }
            : i
        ));
      }
    } catch (err) {
      console.error('Error updating item:', err);
    }
  };

  // Recalculer les prix basés sur les coûts actuels des variantes
  const recalculatePrices = async () => {
    if (!currentShop || !orderId) return;
    
    setSaving(true);
    try {
      const response = await fetch(`/api/suppliers/orders/${orderId}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: currentShop.id,
          action: 'recalculate_prices',
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        notifications.show({
          title: 'Succès',
          message: data.message || 'Prix recalculés',
          color: 'green',
        });
        fetchOrder();
      } else {
        throw new Error('Failed to recalculate');
      }
    } catch (err) {
      console.error('Error recalculating prices:', err);
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de recalculer les prix',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  // Rafraîchir les métachamps de tous les articles
  const refreshMetafields = async () => {
    if (!currentShop || !orderId) return;
    
    setSaving(true);
    try {
      const response = await fetch(`/api/suppliers/orders/${orderId}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: currentShop.id,
          action: 'refresh_metafields',
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        notifications.show({
          title: 'Succès',
          message: data.message || 'Métachamps mis à jour',
          color: 'green',
        });
        fetchOrder();
      } else {
        throw new Error('Failed to refresh');
      }
    } catch (err) {
      console.error('Error refreshing metafields:', err);
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de rafraîchir les métachamps',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  // Sauvegarder les modifications de la commande
  const saveOrder = async () => {
    if (!currentShop || !order) return;
    
    setSaving(true);
    try {
      const response = await fetch('/api/suppliers/orders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: order.id,
          shopId: currentShop.id,
          note,
          balance_adjustment: balanceAdjustment,
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setOrder(data.order);
        notifications.show({
          title: 'Succès',
          message: 'Commande sauvegardée',
          color: 'green',
        });
      }
    } catch (err) {
      console.error('Error saving order:', err);
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de sauvegarder',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  // Changer le statut de la commande
  const changeStatus = async (newStatus: 'draft' | 'requested' | 'produced' | 'completed') => {
    if (!currentShop || !order) return;

    // For completed: use streaming endpoint with terminal
    if (newStatus === 'completed') {
      const validatedCount = items.filter(i => i.is_validated).length;
      if (!confirm(`Terminer cette commande ?\n\n${validatedCount} article(s) validé(s) seront ajoutés au stock et synchronisés vers Shopify.\n\nCette action est irréversible.`)) {
        return;
      }

      const params = new URLSearchParams({
        orderId,
        shopId: currentShop.id,
      });
      if (currentLocation?.id) params.set('locationId', currentLocation.id);

      setSaving(true);
      try {
        await streamFromUrl(`/api/suppliers/orders/stock-stream?${params}`, {
          title: `Ajout au stock — ${order.order_number}`,
          onComplete: () => {
            fetchOrder();
          },
        });
      } catch (err) {
        console.error('Error streaming stock:', err);
        notifications.show({
          title: 'Erreur',
          message: 'Erreur durant l\'ajout au stock',
          color: 'red',
        });
      } finally {
        setSaving(false);
      }
      return;
    }

    // For other statuses: regular PUT
    setSaving(true);
    try {
      const response = await fetch('/api/suppliers/orders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: order.id,
          shopId: currentShop.id,
          status: newStatus,
          locationId: currentLocation?.id,
        }),
      });

      if (response.ok) {
        const statusLabels: Record<string, string> = {
          draft: 'Brouillon',
          requested: 'Demandée',
          produced: 'Produite',
        };

        notifications.show({
          title: 'Succès',
          message: `Commande passée en "${statusLabels[newStatus]}"`,
          color: 'green',
        });
        fetchOrder();
      } else {
        throw new Error('Failed to update status');
      }
    } catch (err) {
      console.error('Error changing status:', err);
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de changer le statut',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  // Réessayer les articles échoués (streaming)
  const retryFailedStock = async () => {
    if (!currentShop || !order) return;

    const params = new URLSearchParams({
      orderId,
      shopId: currentShop.id,
      retryOnly: 'true',
    });
    if (currentLocation?.id) params.set('locationId', currentLocation.id);

    setSaving(true);
    try {
      await streamFromUrl(`/api/suppliers/orders/stock-stream?${params}`, {
        title: `Retry stock — ${order.order_number}`,
        onComplete: () => {
          fetchOrder();
        },
      });
    } catch (err) {
      console.error('Error retrying stock:', err);
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de réessayer',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  // Extraire couleur et taille depuis variant_title
  const extractOptions = useCallback((variantTitle: string | null) => {
    const parts = (variantTitle || '').split(' / ');
    const color = parts.find(p => getSizeIndex(p.trim()) === 999) || '';
    const size = parts.find(p => getSizeIndex(p.trim()) !== 999) || '';
    return { color, size };
  }, []);

  // Comparer deux items selon un critère donné
  const compareByCriterion = useCallback((itemA: OrderItem, itemB: OrderItem, criterion: string): number => {
    switch (criterion) {
      case 'Nom':
        return (itemA.product_title || '').localeCompare(itemB.product_title || '', 'fr');
      case 'Couleur': {
        const colA = extractOptions(itemA.variant_title).color;
        const colB = extractOptions(itemB.variant_title).color;
        return colA.localeCompare(colB, 'fr');
      }
      case 'Taille': {
        const sizeA = extractOptions(itemA.variant_title).size;
        const sizeB = extractOptions(itemB.variant_title).size;
        return getSizeIndex(sizeA) - getSizeIndex(sizeB);
      }
      default:
        return 0;
    }
  }, [extractOptions]);

  // Grouper les articles puis trier selon l'ordre de priorité choisi
  const groupedItems = useMemo(() => {
    const groups: Record<string, Array<{ key: string; items: OrderItem[] }>> = {};

    const addToGroup = (groupKey: string, item: OrderItem) => {
      if (!groups[groupKey]) groups[groupKey] = [];
      const variantKey = `${item.variant_id || ''}_${item.sku || ''}_${item.variant_title || ''}`;
      let variantGroup = groups[groupKey].find(g => g.key === variantKey);
      if (!variantGroup) {
        variantGroup = { key: variantKey, items: [] };
        groups[groupKey].push(variantGroup);
      }
      variantGroup.items.push(item);
    };

    // Toujours grouper par préfixe SKU
    items.forEach(item => {
      const prefix = item.sku?.match(/^([A-Za-z]+)/)?.[1]?.toUpperCase() || 'AUTRES';
      addToGroup(prefix, item);
    });

    // Trier chaque groupe selon tous les critères dans l'ordre de priorité
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => {
        const itemA = a.items[0];
        const itemB = b.items[0];

        for (const criterion of sortOrder) {
          const cmp = compareByCriterion(itemA, itemB, criterion);
          if (cmp !== 0) return cmp;
        }
        return 0;
      });
    });

    return groups;
  }, [items, sortOrder, compareByCriterion]);

  // Calculer les totaux (UNIQUEMENT les items cochés)
  const totals = useMemo(() => {
    // Sous-total = somme des items validés uniquement
    const validatedItems = items.filter(i => i.is_validated);
    const subtotal = validatedItems.reduce((sum, item) => sum + item.line_total, 0);
    const totalHt = subtotal + balanceAdjustment;
    const totalTtc = totalHt * 1.2;
    const validatedCount = validatedItems.length;
    const progress = items.length > 0 ? (validatedCount / items.length) * 100 : 0;

    // Total projeté = si toutes les cases étaient cochées
    const projectedSubtotal = items.reduce((sum, item) => sum + item.line_total, 0);
    const projectedHt = projectedSubtotal + balanceAdjustment;
    const projectedTtc = projectedHt * 1.2;

    return { subtotal, totalHt, totalTtc, validatedCount, progress, totalItems: items.length, projectedTtc };
  }, [items, balanceAdjustment]);

  if (loading) {
    return (
      <Center h={400}>
        <Loader size="lg" />
      </Center>
    );
  }

  if (!order) {
    return (
      <Center h={400}>
        <Text c="dimmed">Commande non trouvée</Text>
      </Center>
    );
  }

  const isCompleted = order.status === 'completed';

  return (
    <div className={styles.container}>
      {/* Header */}
      <Group justify="space-between" mb="lg">
        <Group>
          <Button
            variant="subtle"
            color="gray"
            leftSection={<IconArrowLeft size={18} />}
            onClick={() => router.push('/ivy/commandes/stock')}
          >
            Retour
          </Button>
          <Title order={2}>{order.order_number}</Title>
          <Badge 
            color={
              order.status === 'completed' ? 'green' : 
              order.status === 'produced' ? 'teal' : 
              order.status === 'requested' ? 'blue' : 'gray'
            }
            size="lg"
          >
            {order.status === 'completed' ? 'Terminée' : 
             order.status === 'produced' ? 'Produite' : 
             order.status === 'requested' ? 'Demandée' : 'Brouillon'}
          </Badge>
          <Button
            variant="light"
            color="green"
            leftSection={<IconChecklist size={18} />}
            onClick={() => router.push(`/ivy/commandes/stock/${orderId}/feuillet`)}
          >
            Feuillet de commande
          </Button>
          <Button
            variant="light"
            color="violet"
            leftSection={<IconPrinter size={18} />}
            onClick={() => router.push(`/ivy/commandes/stock/${orderId}/impression`)}
          >
            Feuillet de production
          </Button>
        </Group>
        
        <Group>
          {/* Actions selon le statut */}
          {order.status === 'draft' && (
            <>
              <Button
                variant="light"
                leftSection={<IconPlus size={18} />}
                onClick={handleOpenAddModal}
              >
                Ajouter des articles
              </Button>
              <Button
                variant="light"
                color="orange"
                leftSection={<IconRefresh size={18} />}
                onClick={recalculatePrices}
                loading={saving}
                disabled={items.length === 0}
              >
                Recalculer les prix
              </Button>
              <Button
                variant="light"
                color="violet"
                leftSection={<IconTag size={18} />}
                onClick={refreshMetafields}
                loading={saving}
                disabled={items.length === 0}
              >
                Rafraîchir métachamps
              </Button>
              <Button
                leftSection={<IconDeviceFloppy size={18} />}
                onClick={saveOrder}
                loading={saving}
              >
                Sauvegarder
              </Button>
              <Button
                color="blue"
                leftSection={<IconCheck size={18} />}
                onClick={() => changeStatus('requested')}
                disabled={items.length === 0}
                loading={saving}
              >
                Passer en Demandée
              </Button>
            </>
          )}
          
          {order.status === 'requested' && (
            <>
              <Button
                variant="light"
                color="gray"
                onClick={() => changeStatus('draft')}
                loading={saving}
              >
                Repasser en Brouillon
              </Button>
              <Button
                color="teal"
                leftSection={<IconCheck size={18} />}
                onClick={() => changeStatus('produced')}
                loading={saving}
              >
                Marquer comme Produite
              </Button>
            </>
          )}
          
          {order.status === 'produced' && (
            <>
              <Button
                variant="light"
                color="gray"
                onClick={() => changeStatus('requested')}
                loading={saving}
              >
                Repasser en Demandée
              </Button>
              <Button
                color="green"
                leftSection={<IconLock size={18} />}
                onClick={() => changeStatus('completed')}
                loading={saving}
              >
                Terminer et ajouter au stock
              </Button>
            </>
          )}

          {isCompleted && items.some(i => i.stock_status === 'failed') && (
            <Button
              color="orange"
              leftSection={<IconRefresh size={18} />}
              onClick={retryFailedStock}
              loading={saving}
            >
              Réessayer les échoués ({items.filter(i => i.stock_status === 'failed').length})
            </Button>
          )}
        </Group>
      </Group>

      {/* Progression */}
      <Paper withBorder p="md" radius="md" mb="lg">
        <Group justify="space-between" mb="xs">
          <Text fw={600}>Progression de validation</Text>
          <Text size="sm" c="dimmed">
            {totals.validatedCount} / {items.length} articles validés
          </Text>
        </Group>
        <Progress value={totals.progress} size="lg" color="green" />
      </Paper>

      {/* Note */}
      <Paper withBorder p="md" radius="md" mb="lg">
        <Textarea
          label="Note de commande"
          placeholder="Ajouter une note..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={isCompleted}
          rows={2}
        />
      </Paper>

      {/* Tri des articles par drag & drop */}
      {items.length > 0 && (
        <Paper withBorder p="sm" radius="md" mb="md">
          <SortOptionsBar options={sortOrder} onReorder={setSortOrder} />
        </Paper>
      )}

      {/* Articles */}
      {Object.keys(groupedItems).length > 0 ? (
        Object.entries(groupedItems).map(([prefix, variantGroups]) => (
          <Paper key={prefix} withBorder radius="md" mb="lg">
            <div className={styles.groupHeader}>
              <Group>
                <IconPackage size={20} />
                <Text fw={600}>{prefix}</Text>
                <Badge variant="light">{variantGroups.reduce((sum, g) => sum + g.items.length, 0)} article(s)</Badge>
              </Group>
            </div>
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{isCompleted ? 'Stock' : 'Validé'}</Table.Th>
                  <Table.Th>Produit</Table.Th>
                  <Table.Th>SKU</Table.Th>
                  <Table.Th>Variante</Table.Th>
                  <Table.Th>Métachamps</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Qté</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Coût unit.</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Total validé</Table.Th>
                  {!isCompleted && <Table.Th style={{ width: 50 }}></Table.Th>}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {variantGroups.map((variantGroup) => {
                  const firstItem = variantGroup.items[0];
                  const validatedCount = variantGroup.items.filter(i => i.is_validated).length;
                  const validatedTotal = variantGroup.items.filter(i => i.is_validated).reduce((sum, i) => sum + i.line_total, 0);
                  const allValidated = validatedCount === variantGroup.items.length;
                  const someValidated = validatedCount > 0 && !allValidated;
                  const metafields = firstItem.metafields || {};
                  
                  return (
                    <Table.Tr key={variantGroup.key} className={allValidated ? styles.validatedRow : ''}>
                      <Table.Td>
                        <Group gap={4}>
                          {isCompleted ? (
                            variantGroup.items.map((item) => {
                              if (item.stock_status === 'added') {
                                return <Badge key={item.id} size="sm" color="green">Ajouté</Badge>;
                              } else if (item.stock_status === 'failed') {
                                return (
                                  <Tooltip key={item.id} label={item.stock_error || 'Erreur inconnue'} multiline w={300}>
                                    <Badge size="sm" color="red" style={{ cursor: 'help' }}>Échoué</Badge>
                                  </Tooltip>
                                );
                              } else if (!item.is_validated) {
                                return <Badge key={item.id} size="sm" color="gray" variant="light">Non validé</Badge>;
                              } else {
                                return <Badge key={item.id} size="sm" color="yellow">En attente</Badge>;
                              }
                            })
                          ) : (
                            variantGroup.items.map((item) => (
                              <Checkbox
                                key={item.id}
                                checked={item.is_validated}
                                onChange={(e) => toggleValidation(item.id, e.currentTarget.checked)}
                                size="sm"
                              />
                            ))
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>{firstItem.product_title}</Table.Td>
                      <Table.Td>
                        <Badge variant="light" color="gray">{firstItem.sku || '-'}</Badge>
                      </Table.Td>
                      <Table.Td>{firstItem.variant_title || '-'}</Table.Td>
                      <Table.Td>
                        {Object.keys(metafields).length > 0 ? (
                          <Group gap={4}>
                            {Object.entries(metafields).map(([key, value]) => (
                              <Badge key={key} variant="light" color="violet" size="sm">
                                {key}: {value}
                              </Badge>
                            ))}
                          </Group>
                        ) : (
                          <Text size="xs" c="dimmed">-</Text>
                        )}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text size="sm" c={someValidated ? 'orange' : undefined}>
                          {validatedCount}/{variantGroup.items.length}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{firstItem.unit_price.toFixed(2)} €</Table.Td>
                      <Table.Td style={{ textAlign: 'right', fontWeight: 600 }}>{validatedTotal.toFixed(2)} €</Table.Td>
                      {!isCompleted && (
                        <Table.Td>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            onClick={() => {
                              variantGroup.items.forEach(item => deleteItem(item.id));
                            }}
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Table.Td>
                      )}
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Paper>
        ))
      ) : (
        <Paper withBorder p="xl" radius="md" mb="lg">
          <Text c="dimmed" ta="center">
            Aucun article dans cette commande. Cliquez sur "Ajouter des articles" pour commencer.
          </Text>
        </Paper>
      )}

      {/* Facturation */}
      <Paper withBorder p="md" radius="md">
        <Title order={4} mb="md">Facturation</Title>
        <Stack gap="sm">
          <Group justify="space-between">
            <Text>Sous-total</Text>
            <Text fw={600}>{totals.subtotal.toFixed(2)} €</Text>
          </Group>
          <Group justify="space-between" align="flex-end">
            <NumberInput
              label="Balance (ajustement)"
              value={balanceAdjustment}
              onChange={(value) => setBalanceAdjustment(Number(value) || 0)}
              decimalScale={2}
              prefix={balanceAdjustment >= 0 ? '+' : ''}
              suffix=" €"
              disabled={isCompleted}
              style={{ width: 200 }}
            />
            <Text fw={600}>{balanceAdjustment >= 0 ? '+' : ''}{balanceAdjustment.toFixed(2)} €</Text>
          </Group>
          <Divider />
          <Group justify="space-between">
            <Text fw={600}>Total HT</Text>
            <Text fw={600} size="lg">{totals.totalHt.toFixed(2)} €</Text>
          </Group>
          <Group justify="space-between">
            <Text c="dimmed">TVA (20%)</Text>
            <Text c="dimmed">{(totals.totalHt * 0.2).toFixed(2)} €</Text>
          </Group>
          <Divider />
          <Group justify="space-between">
            <Text fw={700} size="lg">Total TTC</Text>
            <Text fw={700} size="xl" c="green">{totals.totalTtc.toFixed(2)} €</Text>
          </Group>
          {totals.validatedCount < totals.totalItems && (
            <Group justify="space-between">
              <Text size="sm" c="dimmed">Total TTC projeté (si tout validé)</Text>
              <Text size="sm" c="dimmed">{totals.projectedTtc.toFixed(2)} €</Text>
            </Group>
          )}
        </Stack>
      </Paper>

      {/* Modal ajout d'articles */}
      <Modal
        opened={addModalOpened}
        onClose={closeAddModal}
        title="Ajouter des articles"
        size="xl"
      >
        <TextInput
          placeholder="Rechercher un produit ou SKU..."
          leftSection={<IconSearch size={16} />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          mb="md"
        />
        
        {/* Filtres SKU */}
        {skuPrefixes.length > 0 && (
          <Group gap="xs" mb="md" wrap="wrap">
            <Text size="sm" fw={500}>SKU:</Text>
            <Badge
              variant={skuFilter === null ? 'filled' : 'light'}
              style={{ cursor: 'pointer' }}
              onClick={() => setSkuFilter(null)}
            >
              Tous
            </Badge>
            {skuPrefixes.map(({ prefix, count }) => (
              <Badge
                key={prefix}
                variant={skuFilter === prefix ? 'filled' : 'light'}
                style={{ cursor: 'pointer' }}
                onClick={() => setSkuFilter(skuFilter === prefix ? null : prefix)}
              >
                {prefix} ({count})
              </Badge>
            ))}
          </Group>
        )}

        {modalProductOptions.length > 1 && products.length > 0 && (
          <SortOptionsBar
            options={modalSortOrder.length > 0 ? modalSortOrder : modalProductOptions}
            onReorder={setModalSortOrder}
          />
        )}

        {searchQuery.length < 3 ? (
          <Center h={200}>
            <Text c="dimmed">Tapez au moins 3 caractères pour rechercher</Text>
          </Center>
        ) : loadingProducts ? (
          <Center h={200}>
            <Loader />
          </Center>
        ) : displayedProducts.length === 0 ? (
          <Center h={200}>
            <Text c="dimmed">Aucun produit trouvé pour "{searchQuery}"</Text>
          </Center>
        ) : (
          <div className={styles.productsList}>
            {displayedProducts.map((product) => (
              <Paper key={product.id} withBorder p="sm" radius="md" mb="sm">
                <Text fw={600} mb="xs">{product.title}</Text>
                <div className={styles.variantsList}>
                  {product.variants.map((variant) => {
                    // Extraire la couleur de la variante
                    // 1) Par nom d'option (Couleur / Color)
                    let colorOption = variant.options?.find((o: any) => isColorOption(o.name));
                    // 2) Fallback : par valeur d'option si c'est une couleur connue
                    if (!colorOption) {
                      colorOption = variant.options?.find((o: any) =>
                        getColorHex(o.value) !== '#808080'
                      );
                    }
                    const colorHex = colorOption ? getColorHex(colorOption.value) : null;
                    
                    return (
                      <Group key={variant.id} justify="space-between" className={styles.variantRow}>
                        <Group gap="xs">
                          {colorHex && (
                            <div
                              style={{
                                width: 16,
                                height: 16,
                                borderRadius: '50%',
                                background: colorHex,
                                border: '1px solid #ddd',
                                flexShrink: 0,
                              }}
                            />
                          )}
                          <Text size="sm">{variant.title}</Text>
                          <Badge size="xs" variant="light">{variant.sku}</Badge>
                          <Badge size="xs" variant="light" color={variant.quantity > 0 ? 'green' : 'red'}>
                            stock: {variant.quantity}
                          </Badge>
                        </Group>
                        <Group gap={4}>
                          <ActionIcon
                            size="xs"
                            variant="light"
                            onClick={() => setSelectedVariants(prev => ({
                              ...prev,
                              [variant.id]: Math.max(0, (prev[variant.id] || 0) - 1),
                            }))}
                          >
                            <IconMinus size={12} />
                          </ActionIcon>
                          <NumberInput
                            size="xs"
                            min={0}
                            value={selectedVariants[variant.id] || 0}
                            onChange={(value) => setSelectedVariants(prev => ({
                              ...prev,
                              [variant.id]: Number(value) || 0,
                            }))}
                            style={{ width: 60 }}
                            hideControls
                          />
                          <ActionIcon
                            size="xs"
                            variant="light"
                            onClick={() => setSelectedVariants(prev => ({
                              ...prev,
                              [variant.id]: (prev[variant.id] || 0) + 1,
                            }))}
                          >
                            <IconPlus size={12} />
                          </ActionIcon>
                        </Group>
                      </Group>
                    );
                  })}
                </div>
              </Paper>
            ))}
          </div>
        )}
        
        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={closeAddModal}>Annuler</Button>
          <Button 
            onClick={addSelectedVariants}
            loading={saving}
            disabled={Object.values(selectedVariants).every(v => v === 0)}
          >
            Ajouter ({Object.values(selectedVariants).filter(v => v > 0).length} variante(s))
          </Button>
        </Group>
      </Modal>
    </div>
  );
}

