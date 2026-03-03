'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Title, Text, SimpleGrid, Loader, Center, TextInput, Group, Button, Paper, Stack, Badge, Modal } from '@mantine/core';
import { IconSearch, IconRefresh, IconDownload, IconAlertTriangle, IconArrowLeft } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useDisclosure } from '@mantine/hooks';
import { useShop } from '@/context/ShopContext';
import { useLocation } from '@/context/LocationContext';
import { useTerminalStream } from '@/hooks/useTerminalStream';
import { ProductCard, ProductData } from '@/components/Inventory';
import { ProductDetailView } from '@/components/Inventory/ProductDetailView';
import { loadColorMappingsFromSupabase } from '@/utils/color-transformer';
import styles from './inventory.module.scss';

export default function InventoryPage() {
  const { currentShop } = useShop();
  const { currentLocation } = useLocation();
  const { streamFromUrl, endSync, log: terminalLog } = useTerminalStream();
  const [products, setProducts] = useState<ProductData[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [needsSync, setNeedsSync] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [productTypeFilter, setProductTypeFilter] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncModalOpened, { open: openSyncModal, close: closeSyncModal }] = useDisclosure(false);
  const scrollPositionRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchProducts = useCallback(async () => {
    if (!currentShop) return;

    setLoading(true);
    setError(null);

    try {
      await loadColorMappingsFromSupabase(currentShop.id);

      const params = new URLSearchParams({ shopId: currentShop.id });
      if (currentLocation) {
        params.append('locationId', currentLocation.id);
      }

      const response = await fetch(`/api/products?${params}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch products');
      }

      const data = await response.json();
      setProducts(data.products || []);
      setNeedsSync(data.needsSync || false);
      
      // Trouver la date de dernière sync
      if (data.products?.length > 0) {
        const dates = data.products.map((p: any) => p.syncedAt).filter(Boolean);
        if (dates.length > 0) {
          setLastSyncedAt(dates.sort().reverse()[0]);
        }
      }
    } catch (err) {
      console.error('Error fetching products:', err);
      setError('Erreur lors du chargement des produits');
    } finally {
      setLoading(false);
    }
  }, [currentShop, currentLocation]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Synchroniser depuis Shopify (appelé après confirmation)
  // Chunked en 3 phases (products → costs → levels) pour respecter le timeout Netlify
  const handleSyncFromShopify = async (productType?: string | null) => {
    if (!currentShop) return;

    closeSyncModal();
    setSyncing(true);

    const baseParams = new URLSearchParams({ shopId: currentShop.id });
    if (currentLocation?.id) {
      baseParams.append('locationId', currentLocation.id);
    }
    if (productType) {
      baseParams.append('productType', productType);
    }

    const title = productType ? `Import: ${productType}` : 'Import Inventaire';

    let phase: string | null = 'products';
    let offset = 0;
    let chunk = 0;

    while (phase) {
      const params = new URLSearchParams(baseParams);
      params.set('phase', phase);
      if (offset > 0) params.set('offset', offset.toString());

      let nextPhase: string | null = null;
      let nextOffset = 0;

      await streamFromUrl(`/api/inventory/sync-stream?${params}`, {
        title: chunk === 0 ? title : undefined,
        noStartSync: chunk > 0,
        noEndSync: true,
        onComplete: (data) => {
          nextPhase = (data?.nextPhase as string) || null;
          nextOffset = (data?.nextOffset as number) || 0;
        },
      });

      phase = nextPhase;
      offset = nextOffset;
      chunk++;
    }

    endSync();
    await fetchProducts();
    setSyncing(false);
  };

  // Extraire les types de produits uniques pour les filtres avec comptage
  const productTypes = useMemo(() => {
    const typeCounts = new Map<string, number>();
    
    products.forEach(product => {
      if (product.productType) {
        typeCounts.set(product.productType, (typeCounts.get(product.productType) || 0) + 1);
      }
    });
    
    // Convertir en tableau avec le comptage
    return Array.from(typeCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => a.type.localeCompare(b.type, 'fr'));
  }, [products]);

  // Filtrer et trier les produits
  const filteredProducts = useMemo(() => {
    let result = [...products];

    // Filtre par recherche (titre ou SKU)
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(product => 
        product.title.toLowerCase().includes(query) ||
        product.variants.some(v => v.sku?.toLowerCase().includes(query))
      );
    }

    // Filtre par type de produit
    if (productTypeFilter) {
      result = result.filter(product => product.productType === productTypeFilter);
    }

    // Trier par ordre alphabétique
    result.sort((a, b) => a.title.localeCompare(b.title, 'fr'));

    return result;
  }, [products, searchQuery, productTypeFilter]);

  // Sélectionner un produit (sauvegarde la position de scroll)
  const handleSelectProduct = useCallback((product: ProductData) => {
    // Sauvegarder la position de scroll actuelle
    const contentElement = containerRef.current?.closest('[class*="content"]');
    if (contentElement) {
      scrollPositionRef.current = contentElement.scrollTop;
    }
    setSelectedProduct(product);
    // Scroller en haut pour la vue détail
    requestAnimationFrame(() => {
      const el = containerRef.current?.closest('[class*="content"]');
      if (el) {
        el.scrollTop = 0;
      }
    });
  }, []);

  // Retour à la liste (restaure la position de scroll)
  const handleBackToList = useCallback(() => {
    setSelectedProduct(null);
    // Restaurer la position de scroll après le rendu
    requestAnimationFrame(() => {
      const contentElement = containerRef.current?.closest('[class*="content"]');
      if (contentElement) {
        contentElement.scrollTop = scrollPositionRef.current;
      }
    });
  }, []);

  // Affichage si besoin de sync initial
  if (!loading && needsSync && products.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <Title order={1}>Inventaire</Title>
        </div>

        <Center h={400}>
          <Paper p="xl" withBorder radius="md" style={{ maxWidth: 500, textAlign: 'center' }}>
            <Stack gap="md">
              <IconRefresh size={48} style={{ margin: '0 auto', opacity: 0.5 }} />
              <Title order={3}>Synchronisation requise</Title>
              <Text c="dimmed">
                Aucun produit en cache. Cliquez sur le bouton ci-dessous pour récupérer 
                vos produits depuis Shopify.
              </Text>
              <Button
                size="lg"
                color="green"
                leftSection={<IconDownload size={20} />}
                onClick={() => handleSyncFromShopify()}
                loading={syncing}
              >
                Récupérer depuis Shopify
              </Button>
            </Stack>
          </Paper>
        </Center>
      </div>
    );
  }

  if (loading) {
    return (
      <Center h={400}>
        <Loader size="lg" color="green" />
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

  // Si un produit est sélectionné, afficher la vue détail
  if (selectedProduct) {
    return (
      <div className={styles.container} ref={containerRef}>
        <ProductDetailView 
          product={selectedProduct} 
          onBack={handleBackToList}
          locationName={currentLocation?.name}
          shopId={currentShop?.id}
          locationId={currentLocation?.id}
          onProductUpdated={(updatedProduct) => {
            // Mettre à jour le produit dans la liste
            setProducts(prev => prev.map(p => 
              p.id === updatedProduct.id ? updatedProduct : p
            ));
            setSelectedProduct(updatedProduct);
          }}
        />

        {/* Modal de confirmation pour la synchronisation */}
        <Modal 
          opened={syncModalOpened} 
          onClose={closeSyncModal}
          title={
            <Group gap="xs">
              <IconAlertTriangle size={20} color="var(--mantine-color-orange-6)" />
              <Text fw={600}>Confirmer la synchronisation</Text>
            </Group>
          }
          centered
        >
          <Stack gap="md">
            <Text size="sm">
              Vous allez écraser vos changements locaux avec les données de la boutique en ligne.
            </Text>
            <Text size="sm" c="dimmed">
              Cette action est irréversible. Êtes-vous sûr de vouloir continuer ?
            </Text>
            <Group justify="flex-end" gap="sm" mt="md">
              <Button variant="default" onClick={closeSyncModal}>
                Annuler
              </Button>
              <Button color="green" onClick={() => handleSyncFromShopify()}>
                Oui, synchroniser
              </Button>
            </Group>
          </Stack>
        </Modal>
      </div>
    );
  }

  return (
    <div className={styles.container} ref={containerRef}>
      <div className={styles.header}>
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={1}>Inventaire</Title>
            <Group gap="xs" mt={4}>
              <Text c="dimmed" size="sm">
                {filteredProducts.length} produit{filteredProducts.length > 1 ? 's' : ''}
              </Text>
              {currentLocation && (
                <Badge variant="light" color="green" size="sm">
                  {currentLocation.name}
                </Badge>
              )}
              {lastSyncedAt && (
                <Text c="dimmed" size="xs">
                  • Sync: {new Date(lastSyncedAt).toLocaleString('fr-FR')}
                </Text>
              )}
            </Group>
          </div>

          <Group gap="xs">
            <Button
              variant="light"
              color="green"
              leftSection={<IconDownload size={16} />}
              onClick={() => productTypeFilter ? handleSyncFromShopify(productTypeFilter) : openSyncModal()}
              loading={syncing}
              size="sm"
            >
              {syncing ? 'Synchronisation...' : productTypeFilter ? `Récupérer: ${productTypeFilter}` : 'Récupérer tout'}
            </Button>
          </Group>
        </Group>
      </div>

      <div className={styles.filters}>
        <TextInput
          className={styles.searchInput}
          placeholder="Rechercher par nom ou SKU..."
          leftSection={<IconSearch size={16} />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.currentTarget.value)}
        />
        
        {productTypes.length > 0 && (
          <div className={styles.skuFilters}>
            <span className={styles.skuLabel}>Type:</span>
            <button
              className={`${styles.skuButton} ${styles.allButton} ${productTypeFilter === null ? styles.active : ''}`}
              onClick={() => setProductTypeFilter(null)}
            >
              Tous
            </button>
            {productTypes.map(({ type, count }) => (
              <button
                key={type}
                className={`${styles.skuButton} ${productTypeFilter === type ? styles.active : ''}`}
                onClick={() => setProductTypeFilter(productTypeFilter === type ? null : type)}
              >
                {type} <span className={styles.skuCount}>({count})</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="md">
        {filteredProducts.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            onClick={() => handleSelectProduct(product)}
          />
        ))}
      </SimpleGrid>

      {filteredProducts.length === 0 && (
        <Center h={200}>
          <Text c="dimmed">Aucun produit trouvé</Text>
        </Center>
      )}

      {/* Modal de confirmation pour la synchronisation */}
      <Modal 
        opened={syncModalOpened} 
        onClose={closeSyncModal}
        title={
          <Group gap="xs">
            <IconAlertTriangle size={20} color="var(--mantine-color-orange-6)" />
            <Text fw={600}>Confirmer la synchronisation</Text>
          </Group>
        }
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Vous allez écraser vos changements locaux avec les données de la boutique en ligne.
          </Text>
          <Text size="sm" c="dimmed">
            Cette action est irréversible. Êtes-vous sûr de vouloir continuer ?
          </Text>
          <Group justify="flex-end" gap="sm" mt="md">
            <Button variant="default" onClick={closeSyncModal}>
              Annuler
            </Button>
            <Button color="green" onClick={() => handleSyncFromShopify()}>
              Oui, synchroniser
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
