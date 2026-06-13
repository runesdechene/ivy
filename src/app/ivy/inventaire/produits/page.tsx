'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Loader, TextInput, Group, Button, Stack, Modal, SimpleGrid, Text } from '@mantine/core';
import { IconSearch, IconRefresh, IconDownload, IconAlertTriangle } from '@tabler/icons-react';
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
  const { streamFromUrl, endSync } = useTerminalStream();
  const [products, setProducts] = useState<ProductData[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [needsSync, setNeedsSync] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [productTypeFilter, setProductTypeFilter] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<'alpha' | 'recent'>('alpha');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncModalOpened, { open: openSyncModal, close: closeSyncModal }] = useDisclosure(false);
  const scrollPositionRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Persistance de la vue dans l'URL (survit au reload + bouton Retour navigateur)
  const [urlHydrated, setUrlHydrated] = useState(false);
  const pendingProductKeyRef = useRef<string | null>(null);
  const productsRef = useRef<ProductData[]>([]);
  productsRef.current = products;
  const productKey = (p: ProductData) => p.supabaseId || p.handle;

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

    return Array.from(typeCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => a.type.localeCompare(b.type, 'fr'));
  }, [products]);

  // Filtrer et trier les produits
  const filteredProducts = useMemo(() => {
    let result = [...products];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(product =>
        product.title.toLowerCase().includes(query) ||
        product.variants.some(v => v.sku?.toLowerCase().includes(query))
      );
    }

    if (productTypeFilter) {
      result = result.filter(product => product.productType === productTypeFilter);
    }

    if (sortMode === 'recent') {
      result.sort((a, b) => {
        const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
        const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
        if (tb !== ta) return tb - ta;
        return a.title.localeCompare(b.title, 'fr');
      });
    } else {
      result.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
    }

    return result;
  }, [products, searchQuery, productTypeFilter, sortMode]);

  // Total variantes affichées (pour le sub head)
  const totalVariants = useMemo(() => {
    return filteredProducts.reduce((sum, p) => sum + p.variants.length, 0);
  }, [filteredProducts]);

  // La boutique attend-elle des métachamps ? Vrai dès qu'au moins une variante de tout le catalogue en a un.
  // Sert à signaler aussi les produits sans aucun métachamp (sinon l'alerte ne s'afficherait que sur les "partiels").
  const expectMetafields = useMemo(() => {
    return products.some(p => p.variants.some(v => (v.metafields?.length || 0) > 0));
  }, [products]);

  // Sélectionner un produit (sauvegarde la position de scroll)
  const handleSelectProduct = useCallback((product: ProductData) => {
    const contentElement = containerRef.current?.closest('[class*="content"]');
    if (contentElement) {
      scrollPositionRef.current = contentElement.scrollTop;
    }
    // Nouvelle entrée d'historique → le bouton Retour du navigateur revient à la liste
    const sp = new URLSearchParams(window.location.search);
    sp.set('produit', product.supabaseId || product.handle);
    window.history.pushState(window.history.state, '', `${window.location.pathname}?${sp.toString()}`);
    setSelectedProduct(product);
    requestAnimationFrame(() => {
      const el = containerRef.current?.closest('[class*="content"]');
      if (el) {
        el.scrollTop = 0;
      }
    });
  }, []);

  const handleBackToList = useCallback(() => {
    setSelectedProduct(null);
    requestAnimationFrame(() => {
      const contentElement = containerRef.current?.closest('[class*="content"]');
      if (contentElement) {
        contentElement.scrollTop = scrollPositionRef.current;
      }
    });
  }, []);

  // 1. Restaure l'état depuis l'URL au montage + suit le bouton Retour/Avancer du navigateur
  useEffect(() => {
    const applyProductFromUrl = () => {
      const produit = new URLSearchParams(window.location.search).get('produit');
      if (produit) {
        const found = productsRef.current.find(p => productKey(p) === produit);
        if (found) {
          setSelectedProduct(found);
          pendingProductKeyRef.current = null;
        } else {
          pendingProductKeyRef.current = produit; // produits pas encore chargés → restauré plus tard
        }
      } else {
        setSelectedProduct(null);
        pendingProductKeyRef.current = null;
      }
    };

    const sp = new URLSearchParams(window.location.search);
    const q = sp.get('q');
    const type = sp.get('type');
    const tri = sp.get('tri');
    if (q) setSearchQuery(q);
    if (type) setProductTypeFilter(type);
    if (tri === 'recent') setSortMode('recent');
    applyProductFromUrl();

    setUrlHydrated(true);
    window.addEventListener('popstate', applyProductFromUrl);
    return () => window.removeEventListener('popstate', applyProductFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Une fois les produits chargés, ouvre la fiche demandée par l'URL (reload direct sur un produit)
  useEffect(() => {
    if (!urlHydrated || products.length === 0) return;
    const key = pendingProductKeyRef.current;
    if (!key) return;
    const found = products.find(p => productKey(p) === key);
    if (found) setSelectedProduct(found);
    pendingProductKeyRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlHydrated, products]);

  // 3. Reflète l'état (produit ouvert + recherche/filtre/tri) dans l'URL
  useEffect(() => {
    if (!urlHydrated) return;
    const sp = new URLSearchParams();
    if (searchQuery) sp.set('q', searchQuery);
    if (productTypeFilter) sp.set('type', productTypeFilter);
    if (sortMode !== 'alpha') sp.set('tri', sortMode);
    const pid = selectedProduct ? productKey(selectedProduct) : pendingProductKeyRef.current;
    if (pid) sp.set('produit', pid);
    const qs = sp.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(window.history.state, '', url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlHydrated, searchQuery, productTypeFilter, sortMode, selectedProduct]);

  const shopName = currentShop?.name || 'Runes de Chêne';

  // Affichage si besoin de sync initial
  if (!loading && needsSync && products.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.pageHead}>
          <div className={styles.pageHeadLeft}>
            <div className={styles.eyebrow}>Inventaire · {shopName}</div>
            <h1 className={styles.title}>
              Produits <em>du catalogue</em>
            </h1>
          </div>
        </div>

        <div className={styles.syncPrompt}>
          <IconRefresh size={48} className={styles.syncPromptIcon} />
          <div className={styles.syncPromptTitle}>Synchronisation requise</div>
          <div className={styles.syncPromptHint}>
            Aucun produit en cache. Cliquez sur le bouton ci-dessous pour récupérer
            vos produits depuis Shopify.
          </div>
          <Button
            size="md"
            color="slate.8"
            leftSection={<IconDownload size={18} />}
            onClick={() => handleSyncFromShopify()}
            loading={syncing}
            radius="md"
          >
            Récupérer depuis Shopify
          </Button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingWrap}>
          <Loader color="moss" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.errorWrap}>{error}</div>
      </div>
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
          radius="lg"
          title={
            <span className={styles.modalTitle}>
              <IconAlertTriangle size={18} />
              Confirmer la <em>synchronisation</em>
            </span>
          }
          centered
        >
          <Stack gap="md">
            <Text size="sm" c="slate.7">
              Vous allez écraser vos changements locaux avec les données de la boutique en ligne.
            </Text>
            <Text size="xs" c="slate.5" fs="italic">
              Cette action est irréversible. Êtes-vous sûr de vouloir continuer ?
            </Text>
            <Group justify="flex-end" gap="sm" mt="md">
              <Button variant="default" color="slate" onClick={closeSyncModal}>
                Annuler
              </Button>
              <Button color="moss" onClick={() => handleSyncFromShopify()}>
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
      <div className={styles.pageHead}>
        <div className={styles.pageHeadLeft}>
          <div className={styles.eyebrow}>Inventaire · {shopName}</div>
          <h1 className={styles.title}>
            Produits <em>du catalogue</em>
          </h1>
          <div className={styles.sub}>
            <span>
              {filteredProducts.length} produit{filteredProducts.length > 1 ? 's' : ''}
            </span>
            <span className={styles.subSep}>·</span>
            <span>
              {totalVariants} variante{totalVariants > 1 ? 's' : ''}
            </span>
            {currentLocation && (
              <>
                <span className={styles.subSep}>·</span>
                <span className={styles.locationChip}>{currentLocation.name}</span>
              </>
            )}
            {lastSyncedAt && (
              <>
                <span className={styles.subSep}>·</span>
                <span>Sync : {new Date(lastSyncedAt).toLocaleString('fr-FR')}</span>
              </>
            )}
          </div>
        </div>

        <Group gap="xs">
          <Button
            variant="light"
            color="moss"
            leftSection={<IconDownload size={16} />}
            onClick={() => productTypeFilter ? handleSyncFromShopify(productTypeFilter) : openSyncModal()}
            loading={syncing}
            size="sm"
            radius="md"
          >
            {syncing ? 'Synchronisation…' : productTypeFilter ? `Récupérer : ${productTypeFilter}` : 'Récupérer tout'}
          </Button>
        </Group>
      </div>

      <div className={styles.filters}>
        <TextInput
          className={styles.searchInput}
          placeholder="Rechercher par nom ou SKU…"
          leftSection={<IconSearch size={16} />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.currentTarget.value)}
          radius="md"
        />

        {productTypes.length > 0 && (
          <div className={styles.skuFilters}>
            <span className={styles.skuLabel}>Type</span>
            <button
              type="button"
              className={`${styles.skuButton} ${styles.allButton} ${productTypeFilter === null ? styles.active : ''}`}
              onClick={() => setProductTypeFilter(null)}
            >
              Tous
            </button>
            {productTypes.map(({ type, count }) => (
              <button
                key={type}
                type="button"
                className={`${styles.skuButton} ${productTypeFilter === type ? styles.active : ''}`}
                onClick={() => setProductTypeFilter(productTypeFilter === type ? null : type)}
              >
                {type}
                <span className={styles.skuCount}>({count})</span>
              </button>
            ))}
          </div>
        )}

        <div className={styles.skuFilters}>
          <span className={styles.skuLabel}>Tri</span>
          <button
            type="button"
            className={`${styles.skuButton} ${sortMode === 'alpha' ? styles.active : ''}`}
            onClick={() => setSortMode('alpha')}
          >
            Alphabétique
          </button>
          <button
            type="button"
            className={`${styles.skuButton} ${sortMode === 'recent' ? styles.active : ''}`}
            onClick={() => setSortMode('recent')}
          >
            Récent
          </button>
        </div>
      </div>

      <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="md">
        {filteredProducts.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            onClick={() => handleSelectProduct(product)}
            expectMetafields={expectMetafields}
          />
        ))}
      </SimpleGrid>

      {filteredProducts.length === 0 && (
        <div className={styles.emptyState}>Aucun produit trouvé</div>
      )}

      {/* Modal de confirmation pour la synchronisation */}
      <Modal
        opened={syncModalOpened}
        onClose={closeSyncModal}
        radius="lg"
        title={
          <span className={styles.modalTitle}>
            <IconAlertTriangle size={18} />
            Confirmer la <em>synchronisation</em>
          </span>
        }
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="slate.7">
            Vous allez écraser vos changements locaux avec les données de la boutique en ligne.
          </Text>
          <Text size="xs" c="slate.5" fs="italic">
            Cette action est irréversible. Êtes-vous sûr de vouloir continuer ?
          </Text>
          <Group justify="flex-end" gap="sm" mt="md">
            <Button variant="default" color="slate" onClick={closeSyncModal}>
              Annuler
            </Button>
            <Button color="moss" onClick={() => handleSyncFromShopify()}>
              Oui, synchroniser
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
