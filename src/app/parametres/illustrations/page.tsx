'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Stack, Group, Switch, SimpleGrid, Loader, Image, Tooltip,
} from '@mantine/core';
import { IconRefresh, IconPhoto, IconPhotoOff } from '@tabler/icons-react';
import { useShop } from '@/context/ShopContext';
import { useTerminalStream } from '@/hooks/useTerminalStream';
import { createClient } from '@supabase/supabase-js';
import styles from '../parametres.module.scss';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface ProductRow {
  id: string;
  title: string;
  illustration_url: string | null;
}

export default function IllustrationsPage() {
  const { currentShop } = useShop();
  const { streamFromUrl, log: terminalLog, endSync } = useTerminalStream();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);

  const fetchProducts = useCallback(async () => {
    if (!currentShop) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('products')
      .select('id, title, illustration_url')
      .eq('shop_id', currentShop.id)
      .neq('status', 'local')
      .order('title', { ascending: true });
    if (!error && data) setProducts(data as ProductRow[]);
    setLoading(false);
  }, [currentShop]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const visible = useMemo(
    () => onlyMissing ? products.filter(p => !p.illustration_url) : products,
    [products, onlyMissing]
  );

  const missingCount = useMemo(
    () => products.filter(p => !p.illustration_url).length,
    [products]
  );

  const runSync = async () => {
    if (!currentShop) return;
    setSyncing(true);

    let cursor: string | null = null;
    let offset = 0;
    let totalUpdated = 0;
    let totalMissing = 0;
    let totalErrors = 0;
    let chunk = 0;

    do {
      const params = new URLSearchParams({ shopId: currentShop.id });
      if (cursor) params.set('cursor', cursor);
      if (offset > 0) params.set('offset', offset.toString());

      let nextCursor: string | null = null;

      await streamFromUrl(`/api/settings/illustrations/sync-stream?${params}`, {
        title: chunk === 0 ? 'Sync illustrations' : undefined,
        noStartSync: chunk > 0,
        noEndSync: true,
        onComplete: (data) => {
          nextCursor = (data?.nextCursor as string) || null;
          offset = (data?.offset as number) || offset;
          totalUpdated += (data?.updatedCount as number) || 0;
          totalMissing += (data?.missingCount as number) || 0;
          totalErrors += (data?.errorCount as number) || 0;
        },
      });

      cursor = nextCursor;
      chunk++;
    } while (cursor);

    terminalLog('', 'info');
    terminalLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    terminalLog(`Terminé: ${totalUpdated} avec illustration, ${totalMissing} sans, ${totalErrors} erreur(s)`, 'success');
    endSync();

    await fetchProducts();
    setSyncing(false);
  };

  const shopName = currentShop?.name || 'Runes de Chêne';

  if (loading) {
    return <div className={styles.loadingWrap}><Loader size="lg" /></div>;
  }

  return (
    <div>
      <div className={styles.pageHead}>
        <div className={styles.pageHeadLeft}>
          <div className={styles.eyebrow}>Paramètres · {shopName}</div>
          <h1 className={styles.title}>
            <em>Illustrations</em> produits
          </h1>
          <div className={styles.sub}>
            Récupérées depuis les métaobjets Shopify, affichées sur le feuillet de production
          </div>
        </div>
      </div>

      <Stack gap="lg">
        <Group justify="space-between">
          <Group gap="md">
            <span className={styles.badge + ' ' + styles.badge_plum} style={{ fontSize: 12, padding: '5px 12px' }}>
              {products.length} produit(s)
            </span>
            <span className={`${styles.badge} ${missingCount > 0 ? styles.badge_clay : styles.badge_moss}`} style={{ fontSize: 12, padding: '5px 12px' }}>
              {missingCount} sans illustration
            </span>
          </Group>
          <Switch
            label="Afficher uniquement les produits sans illustration"
            checked={onlyMissing}
            onChange={(e) => setOnlyMissing(e.currentTarget.checked)}
          />
        </Group>

        {visible.length === 0 ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyStateText}>
              {onlyMissing ? 'Toutes les illustrations sont à jour.' : 'Aucun produit.'}
            </p>
          </div>
        ) : (
          <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 6 }} spacing="md">
            {visible.map(p => (
              <div key={p.id} className={styles.illustrationCard}>
                {p.illustration_url ? (
                  <Image
                    src={p.illustration_url}
                    alt={p.title}
                    w={80}
                    h={80}
                    fit="contain"
                    radius="sm"
                  />
                ) : (
                  <Tooltip label="Illustration manquante">
                    <div className={styles.illustrationPlaceholder}>
                      <IconPhotoOff size={24} />
                    </div>
                  </Tooltip>
                )}
                <span className={styles.illustrationTitle}>{p.title}</span>
                {p.illustration_url ? (
                  <span className={styles.badge + ' ' + styles.badge_moss}>
                    <IconPhoto size={10} />
                    OK
                  </span>
                ) : (
                  <span className={styles.badge + ' ' + styles.badge_clay}>
                    Manquante
                  </span>
                )}
              </div>
            ))}
          </SimpleGrid>
        )}

        <div className={styles.syncBar}>
          <span className={styles.syncBarHint}>
            Opération rare. À lancer après avoir ajouté ou modifié des illustrations côté Shopify.
          </span>
          <button
            className={styles.ghostButton}
            onClick={runSync}
            disabled={syncing}
          >
            {syncing ? <Loader size={14} /> : <IconRefresh size={16} />}
            Resynchroniser depuis Shopify
          </button>
        </div>
      </Stack>
    </div>
  );
}
