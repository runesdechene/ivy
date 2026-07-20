'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Text, Button, Group, Modal, NumberInput, Checkbox, Loader, Center, Textarea, TextInput, Tooltip, ActionIcon } from '@mantine/core';
import { IconArrowLeft, IconPlus, IconTrash, IconDeviceFloppy, IconCheck, IconLock, IconSearch, IconMinus, IconRefresh, IconTag, IconPrinter, IconChecklist, IconDots } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useDisclosure } from '@mantine/hooks';
import clsx from 'clsx';
import { useShop } from '@/context/ShopContext';
import { useLocation } from '@/context/LocationContext';
import { ProductData } from '@/components/Inventory';
import { SortOptionsBar } from '@/components/Inventory/SortOptionsBar';
import { StatusBadge, type StatusBadgeVariant } from '@/components/StatusBadge';
import { SkuChip } from '@/components/SkuChip';
import { MetaChip } from '@/components/MetaChip';
import { FilterChip } from '@/components/FilterChip';
import { getColorHex, isColorOption, loadColorMappingsFromSupabase, areColorMappingsLoaded, transformColor } from '@/utils/color-transformer';
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
  line_adjustment: number;
  stock_status: 'added' | 'failed' | null;
  stock_error: string | null;
  stock_added_at: string | null;
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

const STATUS_LABELS: Record<SupplierOrder['status'], string> = {
  draft: 'Brouillon',
  requested: 'Demandée',
  produced: 'Produite',
  completed: 'Terminée',
};

const STATUS_VARIANTS: Record<SupplierOrder['status'], StatusBadgeVariant> = {
  draft: 'slate',
  requested: 'plum',
  produced: 'moss',
  completed: 'moss',
};

function formatEuro(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}${Math.abs(n).toFixed(2).replace('.', ',')} €`;
}

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.orderId as string;
  const { currentShop } = useShop();
  const { currentLocation } = useLocation();
  const { streamFromUrl, log: terminalLog, endSync: terminalEndSync } = useTerminalStream();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [order, setOrder] = useState<SupplierOrder | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [note, setNote] = useState('');
  const [balanceAdjustment, setBalanceAdjustment] = useState(0);

  // Kebab menu
  const [kebabOpen, setKebabOpen] = useState(false);
  const kebabRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!kebabOpen) return;
    const onClick = (e: MouseEvent) => {
      if (kebabRef.current && !kebabRef.current.contains(e.target as Node)) {
        setKebabOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [kebabOpen]);

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

  // +/- sur la quantité d'une variante (chaque unité = une ligne). Permet d'ajuster
  // sans devoir supprimer toute la ligne. Garde anti-double-clic par variante.
  const [mutatingKeys, setMutatingKeys] = useState<Set<string>>(new Set());

  const lockKey = (key: string) => setMutatingKeys(prev => new Set(prev).add(key));
  const unlockKey = (key: string) =>
    setMutatingKeys(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

  const incrementVariant = async (variantGroup: { key: string; items: OrderItem[] }) => {
    if (!currentShop || isCompleted || mutatingKeys.has(variantGroup.key)) return;
    const f = variantGroup.items[0];
    lockKey(variantGroup.key);
    try {
      const response = await fetch(`/api/suppliers/orders/${orderId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: currentShop.id,
          items: [{
            variant_id: f.variant_id,
            product_title: f.product_title,
            variant_title: f.variant_title,
            sku: f.sku,
            quantity: 1,
          }],
        }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.items?.length) setItems(prev => [...prev, ...data.items]);
      } else {
        notifications.show({ title: 'Erreur', message: 'Impossible d\'ajouter une unité', color: 'red' });
      }
    } catch (err) {
      console.error('Error incrementing variant:', err);
      notifications.show({ title: 'Erreur', message: 'Impossible d\'ajouter une unité', color: 'red' });
    } finally {
      unlockKey(variantGroup.key);
    }
  };

  const decrementVariant = async (variantGroup: { key: string; items: OrderItem[] }) => {
    if (!currentShop || isCompleted || mutatingKeys.has(variantGroup.key)) return;
    if (variantGroup.items.length <= 1) return; // au minimum 1 unité ; pour 0 → bouton Supprimer
    // Retirer en priorité une unité NON validée pour ne pas perdre une validation.
    const target = variantGroup.items.find(i => !i.is_validated) || variantGroup.items[variantGroup.items.length - 1];
    lockKey(variantGroup.key);
    setItems(prev => prev.filter(i => i.id !== target.id)); // optimiste
    try {
      const response = await fetch(
        `/api/suppliers/orders/${orderId}/items?itemId=${target.id}&shopId=${currentShop.id}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        setItems(prev => [...prev, target]); // rollback
        notifications.show({ title: 'Erreur', message: 'Impossible de retirer une unité', color: 'red' });
      }
    } catch (err) {
      console.error('Error decrementing variant:', err);
      setItems(prev => [...prev, target]); // rollback
    } finally {
      unlockKey(variantGroup.key);
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
    setKebabOpen(false);

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
    setKebabOpen(false);

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

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        notifications.show({
          title: data.partial ? 'Succès partiel' : 'Succès',
          message: data.message || 'Métachamps mis à jour',
          color: data.partial ? 'yellow' : 'green',
          autoClose: data.partial ? 8000 : 4000,
        });
        fetchOrder();
      } else {
        // Le serveur a refusé d'écrire (typiquement 502 si tous les batchs Shopify
        // ont échoué) → on affiche le vrai message, on ne touche surtout pas à la DB.
        notifications.show({
          title: 'Erreur',
          message: data.error || `Impossible de rafraîchir les métachamps (HTTP ${response.status})`,
          color: 'red',
          autoClose: 10000,
        });
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

  // Auto-save balance adjustment with debounce
  const initialBalanceRef = useRef<number | null>(null);
  useEffect(() => {
    if (initialBalanceRef.current === null && order) {
      initialBalanceRef.current = order.balance_adjustment || 0;
    }
  }, [order]);

  useEffect(() => {
    if (!currentShop || !order) return;
    if (initialBalanceRef.current === null) return;
    if (balanceAdjustment === initialBalanceRef.current) return;

    const timer = setTimeout(async () => {
      try {
        await fetch('/api/suppliers/orders', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: order.id,
            shopId: currentShop.id,
            note,
            balance_adjustment: balanceAdjustment,
          }),
        });
        initialBalanceRef.current = balanceAdjustment;
      } catch (err) {
        console.error('Auto-save balance failed:', err);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [balanceAdjustment, currentShop, order, note]);

  // Update line adjustment for a variant group (all items with same variant)
  const adjustmentTimers = useRef<Record<string, NodeJS.Timeout>>({});

  const updateLineAdjustment = useCallback((variantKey: string, adjustment: number) => {
    if (!currentShop) return;

    // Find all item IDs matching this variant group key
    const itemIds = items
      .filter(i => `${i.variant_id || ''}_${i.sku || ''}_${i.variant_title || ''}` === variantKey)
      .map(i => i.id);

    if (itemIds.length === 0) return;

    // Update local state immediately
    setItems(prev => prev.map(item =>
      itemIds.includes(item.id)
        ? { ...item, line_adjustment: adjustment, line_total: (item.unit_price + adjustment) * item.quantity }
        : item
    ));

    // Debounce save to DB
    if (adjustmentTimers.current[variantKey]) {
      clearTimeout(adjustmentTimers.current[variantKey]);
    }

    adjustmentTimers.current[variantKey] = setTimeout(async () => {
      try {
        await fetch(`/api/suppliers/orders/${orderId}/items`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopId: currentShop.id,
            action: 'update_line_adjustment',
            itemIds,
            lineAdjustment: adjustment,
          }),
        });
      } catch (err) {
        console.error('Error saving line adjustment:', err);
      }
    }, 800);
  }, [items, currentShop, orderId]);

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

  // Terminer sans ajouter au stock
  const closeWithoutStock = async () => {
    if (!currentShop || !order) return;
    if (!confirm('Terminer cette commande sans ajouter au stock ?\n\nLes articles ne seront pas ajoutés à l\'inventaire.')) return;

    setSaving(true);
    try {
      const response = await fetch('/api/suppliers/orders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: order.id,
          shopId: currentShop.id,
          status: 'completed',
          locationId: currentLocation?.id,
          skipStock: true,
        }),
      });

      if (response.ok) {
        notifications.show({
          title: 'Commande terminée',
          message: 'La commande a été fermée sans ajout au stock',
          color: 'green',
        });
        fetchOrder();
      }
    } catch (err) {
      console.error('Error closing order:', err);
      notifications.show({ title: 'Erreur', message: 'Erreur lors de la fermeture', color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  // Changer le statut de la commande
  const changeStatus = async (newStatus: 'draft' | 'requested' | 'produced' | 'completed') => {
    if (!currentShop || !order) return;

    // For completed: use streaming endpoint with terminal (chunked for Netlify 26s limit)
    if (newStatus === 'completed') {
      if (!currentLocation) {
        notifications.show({
          title: 'Emplacement requis',
          message: 'Sélectionnez un emplacement de stock avant d\'ajouter au stock.',
          color: 'orange',
        });
        return;
      }
      const validatedCount = items.filter(i => i.is_validated).length;
      if (!confirm(`Terminer cette commande ?\n\n${validatedCount} article(s) validé(s) seront ajoutés au stock « ${currentLocation.name} » et synchronisés vers Shopify.\n\nVérifiez que c'est le bon emplacement. Cette action est irréversible.`)) {
        return;
      }

      setSaving(true);
      try {
        await runStockStream(`Ajout au stock — ${order.order_number}`);
        fetchOrder();
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

  // Run the stock-stream endpoint, looping over chunks (Netlify 26s limit).
  // Backend processes 10 variant-groups per invocation and returns { hasMore, nextOffset }.
  const runStockStream = async (title: string, retryOnly = false) => {
    if (!currentShop || !order) return;

    let offset = 0;
    let hasMore = true;
    let chunk = 0;
    const cum = { added: 0, failed: 0, skipped: 0 };

    while (hasMore) {
      const params = new URLSearchParams({
        orderId,
        shopId: currentShop.id,
        offset: String(offset),
      });
      if (retryOnly) params.set('retryOnly', 'true');
      if (currentLocation?.id) params.set('locationId', currentLocation.id);

      let gotMore = false;
      let nextOffset = offset;

      await streamFromUrl(`/api/suppliers/orders/stock-stream?${params}`, {
        title: chunk === 0 ? title : undefined,
        noStartSync: chunk > 0,
        noEndSync: true,
        onComplete: (data) => {
          gotMore = (data?.hasMore as boolean) || false;
          nextOffset = (data?.nextOffset as number) ?? offset;
          const r = data?.stockResult as { added?: number; failed?: number; skipped?: number } | undefined;
          if (r) {
            cum.added += r.added || 0;
            cum.failed += r.failed || 0;
            // skipped is the count of already-added items, computed once on chunk 0
            if ((r.skipped || 0) > cum.skipped) cum.skipped = r.skipped || 0;
          }
        },
      });

      hasMore = gotMore;
      offset = nextOffset;
      chunk++;
    }

    terminalLog('', 'info');
    terminalLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    terminalLog(
      `✅ ${cum.added} ajouté(s) | ❌ ${cum.failed} échoué(s) | ⏭️  ${cum.skipped} ignoré(s)`,
      cum.failed > 0 ? 'warning' : 'success'
    );
    terminalEndSync();
  };

  // Réessayer les articles échoués ou en attente (streaming, chunked)
  const retryFailedStock = async () => {
    if (!currentShop || !order) return;
    if (!currentLocation) {
      notifications.show({
        title: 'Emplacement requis',
        message: 'Sélectionnez un emplacement de stock avant de réessayer.',
        color: 'orange',
      });
      return;
    }
    if (!confirm(`Ajouter les articles restants au stock « ${currentLocation.name} » ?\n\nVérifiez que c'est le bon emplacement.`)) return;

    setSaving(true);
    try {
      await runStockStream(`Ajout au stock — ${order.order_number}`, true);
      fetchOrder();
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

  // Résumé de réception : groupé par Motif (avant « | ») puis par Type (après « | »),
  // somme des quantités de toute la commande. Donne « Hécate : 12 T-shirt unisexe, 8 Débardeur femme ».
  const orderSummary = useMemo(() => {
    const byMotif = new Map<string, Map<string, number>>();
    for (const item of items) {
      const parts = (item.product_title || '').split('|').map(p => p.trim()).filter(Boolean);
      const motif = parts[0] || 'Autres';
      const type = parts.slice(1).join(' | ') || '—';
      const qty = item.quantity || 0;
      if (!byMotif.has(motif)) byMotif.set(motif, new Map());
      const types = byMotif.get(motif)!;
      types.set(type, (types.get(type) || 0) + qty);
    }
    return [...byMotif.entries()]
      .map(([motif, types]) => ({
        motif,
        total: [...types.values()].reduce((s, n) => s + n, 0),
        types: [...types.entries()].sort((a, b) => b[1] - a[1]),
      }))
      .sort((a, b) => a.motif.localeCompare(b.motif, 'fr'));
  }, [items]);

  const totalPieces = useMemo(
    () => orderSummary.reduce((sum, g) => sum + g.total, 0),
    [orderSummary],
  );

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
  const failedOrPendingCount = items.filter(i => i.is_validated && i.stock_status !== 'added').length;
  const hasPendingStock = isCompleted && failedOrPendingCount > 0;
  const statusLabel = STATUS_LABELS[order.status];
  const statusVariant = STATUS_VARIANTS[order.status];

  // Menu d'actions secondaires (recalcul prix / refresh métachamps).
  // Accessible à tous les statuts éditables, pas seulement en brouillon —
  // sinon il fallait repasser la commande en brouillon juste pour rafraîchir.
  const secondaryActionsMenu = (
    <div className={styles.kebabWrap} ref={kebabRef}>
      <button
        type="button"
        className={styles.btnKebab}
        onClick={() => setKebabOpen(v => !v)}
        aria-label="Actions secondaires"
      >
        <IconDots size={14} />
      </button>
      {kebabOpen && (
        <div className={styles.kebabMenu}>
          <button
            type="button"
            className={styles.kebabItem}
            onClick={recalculatePrices}
            disabled={items.length === 0 || saving}
          >
            <IconRefresh size={14} /> Recalculer les prix
          </button>
          <button
            type="button"
            className={styles.kebabItem}
            onClick={refreshMetafields}
            disabled={items.length === 0 || saving}
          >
            <IconTag size={14} /> Rafraîchir métachamps
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className={styles.page}>
      {/* Back button */}
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => router.push('/ivy/commandes/stock')}
      >
        <IconArrowLeft size={14} /> Retour aux commandes stock
      </button>

      {/* Page head */}
      <div className={styles.pageHead}>
        <div className={styles.eyebrow}>Atelier · Runes de Chêne</div>
        <h1 className={styles.title}>
          Commande <em>stock</em>
        </h1>
        <div className={styles.sub}>
          <span>N° {order.order_number}</span>
          <span className={styles.subSep}>·</span>
          <StatusBadge variant={statusVariant}>{statusLabel}</StatusBadge>
          <span className={styles.subSep}>·</span>
          <span>{items.length} article{items.length > 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Action bar */}
      <div className={styles.actionBar}>
        <Button
          variant="light"
          color="moss"
          leftSection={<IconChecklist size={16} />}
          onClick={() => router.push(`/ivy/commandes/stock/${orderId}/feuillet`)}
        >
          Feuillet de commande
        </Button>
        <Button
          variant="light"
          color="plum"
          leftSection={<IconPrinter size={16} />}
          onClick={() => router.push(`/ivy/commandes/stock/${orderId}/impression`)}
        >
          Feuillet de production
        </Button>

        <div className={styles.actionSpacer} />

        {/* Actions selon le statut */}
        {order.status === 'draft' && (
          <>
            <Button
              variant="light"
              color="slate"
              leftSection={<IconPlus size={16} />}
              onClick={handleOpenAddModal}
            >
              Ajouter des articles
            </Button>
            <Button
              variant="light"
              color="slate"
              leftSection={<IconDeviceFloppy size={16} />}
              onClick={saveOrder}
              loading={saving}
            >
              Sauvegarder
            </Button>
            <Button
              color="slate"
              leftSection={<IconCheck size={16} />}
              onClick={() => changeStatus('requested')}
              disabled={items.length === 0}
              loading={saving}
            >
              Passer en Demandée
            </Button>

            {/* Kebab for secondary actions */}
            {secondaryActionsMenu}
          </>
        )}

        {order.status === 'requested' && (
          <>
            <Button
              variant="subtle"
              color="slate"
              onClick={() => changeStatus('draft')}
              loading={saving}
            >
              Repasser en Brouillon
            </Button>
            <Button
              color="moss"
              leftSection={<IconCheck size={16} />}
              onClick={() => changeStatus('produced')}
              loading={saving}
            >
              Marquer comme Produite
            </Button>
            {secondaryActionsMenu}
          </>
        )}

        {order.status === 'produced' && (
          <>
            <Button
              variant="subtle"
              color="slate"
              onClick={() => changeStatus('requested')}
              loading={saving}
            >
              Repasser en Demandée
            </Button>
            <Button
              variant="light"
              color="slate"
              leftSection={<IconLock size={16} />}
              onClick={closeWithoutStock}
              loading={saving}
            >
              Terminer sans stock
            </Button>
            <Button
              color="moss"
              leftSection={<IconLock size={16} />}
              onClick={() => changeStatus('completed')}
              loading={saving}
            >
              Terminer et ajouter au stock
            </Button>
            {secondaryActionsMenu}
          </>
        )}

        {hasPendingStock && (
          <Button
            color="clay"
            leftSection={<IconRefresh size={16} />}
            onClick={retryFailedStock}
            loading={saving}
          >
            Ajouter les restants ({failedOrPendingCount})
          </Button>
        )}
      </div>

      {/* Progression */}
      <div className={clsx(styles.card, styles.cardSm)}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>Progression de <em>validation</em></h3>
          <span className={styles.cardSubNote}>
            {totals.validatedCount} / {items.length} articles validés
          </span>
        </div>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${totals.progress}%` }} />
        </div>
      </div>

      {/* Note */}
      <div className={clsx(styles.card, styles.cardSm)}>
        <Textarea
          label="Note de commande"
          placeholder="Ajouter une note…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={isCompleted}
          rows={2}
          styles={{
            label: {
              fontFamily: 'var(--font-inter)',
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: 'var(--slate-muted)',
              fontWeight: 600,
              marginBottom: 6,
            },
            input: {
              background: 'var(--cream)',
              borderColor: 'var(--divider)',
              fontFamily: 'var(--font-inter)',
              color: 'var(--slate)',
            },
          }}
        />
      </div>

      {/* Résumé de réception — groupé par motif et par type */}
      {orderSummary.length > 0 && (
        <div className={clsx(styles.card, styles.cardSm)}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Résumé de <em>réception</em></h3>
            <span className={styles.cardSubNote}>
              {totalPieces} pièce{totalPieces > 1 ? 's' : ''}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {orderSummary.map((g) => (
              <div
                key={g.motif}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'baseline',
                  gap: 6,
                  fontFamily: 'var(--font-inter)',
                  fontSize: 14,
                }}
              >
                <Text component="span" fw={600} c="var(--slate)">{g.motif}</Text>
                <Text component="span" c="var(--slate-muted)">
                  : {g.types.map(([type, qty]) => `${qty} ${type}`).join(', ')}
                </Text>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tri des articles par drag & drop */}
      {items.length > 0 && (
        <div className={clsx(styles.card, styles.cardSm)}>
          <SortOptionsBar options={sortOrder} onReorder={setSortOrder} />
        </div>
      )}

      {/* Articles */}
      {Object.keys(groupedItems).length > 0 ? (
        Object.entries(groupedItems).map(([prefix, variantGroups]) => {
          const totalInGroup = variantGroups.reduce((sum, g) => sum + g.items.length, 0);
          return (
            <div key={prefix} className={styles.group}>
              <div className={styles.groupHeader}>
                <span className={styles.groupTitle}>{prefix}</span>
                <span className={styles.groupCount}>{totalInGroup} article{totalInGroup > 1 ? 's' : ''}</span>
              </div>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th}>{isCompleted ? 'Stock' : 'Validé'}</th>
                    <th className={styles.th}>Produit</th>
                    <th className={styles.th}>SKU</th>
                    <th className={styles.th}>Variante</th>
                    <th className={styles.th}>Métachamps</th>
                    <th className={clsx(styles.th, styles.thRight)}>Qté</th>
                    <th className={clsx(styles.th, styles.thRight)}>Prix unit.</th>
                    <th className={clsx(styles.th, styles.thRight)} style={{ width: 120 }}>Ajust./u</th>
                    <th className={clsx(styles.th, styles.thRight)}>Total validé</th>
                    {!isCompleted && <th className={styles.th} style={{ width: 48 }} />}
                  </tr>
                </thead>
                <tbody>
                  {variantGroups.map((variantGroup) => {
                    const firstItem = variantGroup.items[0];
                    const validatedCount = variantGroup.items.filter(i => i.is_validated).length;
                    const allValidated = validatedCount === variantGroup.items.length;
                    const someValidated = validatedCount > 0 && !allValidated;
                    const metafields = firstItem.metafields || {};

                    return (
                      <tr key={variantGroup.key} className={allValidated ? styles.validatedRow : undefined}>
                        <td className={styles.td}>
                          <div className={styles.stockBadges}>
                            {isCompleted ? (
                              variantGroup.items.map((item) => {
                                if (item.stock_status === 'added') {
                                  return <StatusBadge key={item.id} variant="moss">Ajouté</StatusBadge>;
                                } else if (item.stock_status === 'failed') {
                                  return (
                                    <Tooltip key={item.id} label={item.stock_error || 'Erreur inconnue'} multiline w={300}>
                                      <span style={{ cursor: 'help', display: 'inline-flex' }}>
                                        <StatusBadge variant="clay">Échoué</StatusBadge>
                                      </span>
                                    </Tooltip>
                                  );
                                } else if (!item.is_validated) {
                                  return <StatusBadge key={item.id} variant="slate">Non validé</StatusBadge>;
                                } else {
                                  return <StatusBadge key={item.id} variant="sand">En attente</StatusBadge>;
                                }
                              })
                            ) : (
                              variantGroup.items.map((item) => (
                                <Checkbox
                                  key={item.id}
                                  checked={item.is_validated}
                                  onChange={(e) => toggleValidation(item.id, e.currentTarget.checked)}
                                  size="sm"
                                  color="moss"
                                />
                              ))
                            )}
                          </div>
                        </td>
                        <td className={clsx(styles.td, styles.tdProductName)}>{firstItem.product_title}</td>
                        <td className={styles.td}>
                          {firstItem.sku ? <SkuChip>{firstItem.sku}</SkuChip> : <span className={styles.metaCellEmpty}>—</span>}
                        </td>
                        <td className={clsx(styles.td, styles.tdVariant)}>{firstItem.variant_title ? firstItem.variant_title.split(' / ').map(transformColor).join(' / ') : '—'}</td>
                        <td className={styles.td}>
                          {Object.keys(metafields).length > 0 ? (
                            <div className={styles.metaChipRow}>
                              {Object.entries(metafields).map(([key, value]) => (
                                <MetaChip key={key} keyName={key} value={String(value)} />
                              ))}
                            </div>
                          ) : (
                            <span className={styles.metaCellEmpty}>—</span>
                          )}
                        </td>
                        <td className={clsx(styles.td, styles.tdRight)}>
                          {isCompleted ? (
                            <span className={someValidated ? styles.qtyPartial : styles.qtyFull}>
                              {validatedCount}/{variantGroup.items.length}
                            </span>
                          ) : (
                            <Group gap={4} justify="flex-end" wrap="nowrap">
                              <ActionIcon
                                variant="default"
                                size="sm"
                                radius="xl"
                                onClick={() => decrementVariant(variantGroup)}
                                disabled={variantGroup.items.length <= 1 || mutatingKeys.has(variantGroup.key)}
                                aria-label="Retirer une unité"
                              >
                                <IconMinus size={14} />
                              </ActionIcon>
                              <span
                                className={someValidated ? styles.qtyPartial : styles.qtyFull}
                                style={{ minWidth: 38, textAlign: 'center' }}
                              >
                                {validatedCount}/{variantGroup.items.length}
                              </span>
                              <ActionIcon
                                variant="default"
                                size="sm"
                                radius="xl"
                                onClick={() => incrementVariant(variantGroup)}
                                disabled={mutatingKeys.has(variantGroup.key)}
                                aria-label="Ajouter une unité"
                              >
                                <IconPlus size={14} />
                              </ActionIcon>
                            </Group>
                          )}
                        </td>
                        <td className={clsx(styles.td, styles.tdRight, styles.tdUnit)}>
                          {formatEuro(firstItem.unit_price)}
                        </td>
                        <td className={clsx(styles.td, styles.tdRight)}>
                          <NumberInput
                            value={firstItem.line_adjustment || 0}
                            onChange={(value) => {
                              const adj = Number(value) || 0;
                              updateLineAdjustment(variantGroup.key, adj);
                            }}
                            decimalScale={2}
                            step={0.5}
                            suffix=" €"
                            size="xs"
                            style={{ width: 110, marginLeft: 'auto' }}
                            styles={{
                              input: {
                                textAlign: 'right',
                                background: 'var(--cream)',
                                borderColor: 'var(--divider)',
                                fontFamily: 'var(--font-inter)',
                                color: 'var(--slate)',
                              },
                            }}
                            disabled={isCompleted}
                          />
                        </td>
                        <td className={clsx(styles.td, styles.tdRight, styles.tdLineTotal)}>
                          {formatEuro(
                            variantGroup.items
                              .filter(i => i.is_validated)
                              .reduce((sum, i) => sum + (i.unit_price + (i.line_adjustment || 0)) * i.quantity, 0)
                          )}
                        </td>
                        {!isCompleted && (
                          <td className={styles.td}>
                            <button
                              type="button"
                              className={styles.deleteBtn}
                              onClick={() => {
                                variantGroup.items.forEach(item => deleteItem(item.id));
                              }}
                              aria-label="Supprimer"
                            >
                              <IconTrash size={14} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })
      ) : (
        <div className={styles.emptyState}>
          Aucun article dans cette commande. Cliquez sur « Ajouter des articles » pour commencer.
        </div>
      )}

      {/* Facturation */}
      <div className={styles.billing}>
        <h2 className={styles.billingTitle}>
          <em>Facturation</em>
        </h2>

        <div className={styles.billingRow}>
          <span>Sous-total</span>
          <span className={styles.billingValue}>{formatEuro(totals.subtotal)}</span>
        </div>

        <div className={styles.billingAdjust}>
          <span className={styles.billingAdjustLabel}>Balance (ajustement)</span>
          <NumberInput
            value={balanceAdjustment}
            onChange={(value) => setBalanceAdjustment(Number(value) || 0)}
            decimalScale={2}
            prefix={balanceAdjustment >= 0 ? '+' : ''}
            suffix=" €"
            style={{ width: 200 }}
            styles={{
              input: {
                background: 'var(--cream)',
                borderColor: 'var(--divider)',
                fontFamily: 'var(--font-inter)',
                color: 'var(--slate)',
                textAlign: 'right',
              },
            }}
            disabled={isCompleted}
          />
        </div>

        <div className={styles.billingDivider} />

        <div className={styles.billingRow}>
          <span style={{ fontWeight: 600 }}>Total HT</span>
          <span className={styles.billingTotalHt}>{formatEuro(totals.totalHt)}</span>
        </div>
        <div className={clsx(styles.billingRow, styles.billingRowMuted)}>
          <span>TVA (20%)</span>
          <span>{formatEuro(totals.totalHt * 0.2)}</span>
        </div>

        <div className={styles.billingDivider} />

        <div className={styles.billingRow}>
          <span style={{ fontFamily: 'var(--font-fraunces)', fontSize: 22, fontWeight: 500, color: 'var(--slate)', letterSpacing: '-0.01em' }}>
            Total TTC
          </span>
          <span className={styles.billingTotalTtc}>{formatEuro(totals.totalTtc)}</span>
        </div>

        {totals.validatedCount < totals.totalItems && (
          <div className={clsx(styles.billingRow, styles.billingRowMuted)} style={{ fontSize: 12 }}>
            <span>Total TTC projeté (si tout validé)</span>
            <span>{formatEuro(totals.projectedTtc)}</span>
          </div>
        )}
      </div>

      {/* Modal ajout d'articles */}
      <Modal
        opened={addModalOpened}
        onClose={closeAddModal}
        title={<span style={{ fontFamily: 'var(--font-fraunces)', fontSize: 20, fontWeight: 500, color: 'var(--slate)', letterSpacing: '-0.01em' }}>Ajouter des articles</span>}
        size="xl"
        styles={{
          content: { background: 'var(--cream-soft)' },
          header: { background: 'var(--cream-soft)', borderBottom: '1px solid var(--divider)' },
        }}
      >
        <TextInput
          placeholder="Rechercher un produit ou SKU…"
          leftSection={<IconSearch size={16} />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          mb="md"
          styles={{
            input: {
              background: 'var(--cream)',
              borderColor: 'var(--divider)',
              fontFamily: 'var(--font-inter)',
            },
          }}
        />

        {/* Filtres SKU */}
        {skuPrefixes.length > 0 && (
          <div className={styles.skuFilterBar}>
            <span className={styles.skuFilterLabel}>SKU :</span>
            <FilterChip
              active={skuFilter === null}
              onClick={() => setSkuFilter(null)}
            >
              Tous
            </FilterChip>
            {skuPrefixes.map(({ prefix, count }) => (
              <FilterChip
                key={prefix}
                active={skuFilter === prefix}
                count={count}
                onClick={() => setSkuFilter(skuFilter === prefix ? null : prefix)}
              >
                {prefix}
              </FilterChip>
            ))}
          </div>
        )}

        {modalProductOptions.length > 1 && products.length > 0 && (
          <SortOptionsBar
            options={modalSortOrder.length > 0 ? modalSortOrder : modalProductOptions}
            onReorder={setModalSortOrder}
          />
        )}

        {searchQuery.length < 3 ? (
          <div className={styles.modalHint}>Tapez au moins 3 caractères pour rechercher.</div>
        ) : loadingProducts ? (
          <Center h={200}>
            <Loader />
          </Center>
        ) : displayedProducts.length === 0 ? (
          <div className={styles.modalHint}>Aucun produit trouvé pour « {searchQuery} ».</div>
        ) : (
          <div className={styles.productsList}>
            {displayedProducts.map((product) => (
              <div key={product.id} className={styles.productCard}>
                <h4 className={styles.productTitle}>{product.title}</h4>
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
                      <div key={variant.id} className={styles.variantRow}>
                        <div className={styles.variantLeft}>
                          {colorHex && (
                            <span className={styles.variantDot} style={{ background: colorHex }} />
                          )}
                          <span className={styles.variantLabel}>{variant.title}</span>
                          {variant.sku && <SkuChip>{variant.sku}</SkuChip>}
                          <span className={clsx(styles.stockPill, variant.quantity > 0 ? styles.stockOk : styles.stockEmpty)}>
                            stock: {variant.quantity}
                          </span>
                        </div>
                        <div className={styles.variantControls}>
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="slate"
                            onClick={() => setSelectedVariants(prev => ({
                              ...prev,
                              [variant.id]: Math.max(0, (prev[variant.id] || 0) - 1),
                            }))}
                          >
                            <IconMinus size={14} />
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
                            styles={{
                              input: {
                                background: 'var(--cream-soft)',
                                borderColor: 'var(--divider)',
                                textAlign: 'center',
                                fontFamily: 'var(--font-inter)',
                              },
                            }}
                          />
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="slate"
                            onClick={() => setSelectedVariants(prev => ({
                              ...prev,
                              [variant.id]: (prev[variant.id] || 0) + 1,
                            }))}
                          >
                            <IconPlus size={14} />
                          </ActionIcon>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <Group justify="flex-end" mt="md">
          <Button variant="subtle" color="slate" onClick={closeAddModal}>Annuler</Button>
          <Button
            color="slate"
            onClick={addSelectedVariants}
            loading={saving}
            disabled={Object.values(selectedVariants).every(v => v === 0)}
          >
            Ajouter ({Object.values(selectedVariants).filter(v => v > 0).length} variante{Object.values(selectedVariants).filter(v => v > 0).length > 1 ? 's' : ''})
          </Button>
        </Group>
      </Modal>
    </div>
  );
}
