'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Title, Text, Paper, Stack, Group, Button, Switch, Badge,
  SimpleGrid, Loader, Center, Image, Tooltip,
} from '@mantine/core';
import { IconRefresh, IconPhoto, IconPhotoOff } from '@tabler/icons-react';
import { useShop } from '@/context/ShopContext';
import { useTerminalStream } from '@/hooks/useTerminalStream';
import { createClient } from '@supabase/supabase-js';

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
    terminalLog(`✅ Terminé: ${totalUpdated} avec illustration, ${totalMissing} sans, ${totalErrors} erreur(s)`, 'success');
    endSync();

    await fetchProducts();
    setSyncing(false);
  };

  if (loading) {
    return <Center h={400}><Loader size="lg" /></Center>;
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Illustrations produits</Title>
        <Text c="dimmed" size="sm">
          Les illustrations sont récupérées depuis les métaobjets Shopify (metafield <code>custom.illustration_produit</code>).
          Elles sont affichées sur le feuillet de production pour guider l'atelier.
        </Text>
      </div>

      <Group justify="space-between">
        <Group gap="md">
          <Badge variant="light" color="blue" size="lg">
            {products.length} produit(s)
          </Badge>
          <Badge variant="light" color={missingCount > 0 ? 'orange' : 'green'} size="lg">
            {missingCount} sans illustration
          </Badge>
        </Group>
        <Switch
          label="Afficher uniquement les produits sans illustration"
          checked={onlyMissing}
          onChange={(e) => setOnlyMissing(e.currentTarget.checked)}
        />
      </Group>

      {visible.length === 0 ? (
        <Paper withBorder p="xl" radius="md">
          <Text c="dimmed" ta="center">
            {onlyMissing ? 'Toutes les illustrations sont à jour.' : 'Aucun produit.'}
          </Text>
        </Paper>
      ) : (
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 6 }} spacing="md">
          {visible.map(p => (
            <Paper key={p.id} withBorder p="sm" radius="md">
              <Stack gap="xs" align="center">
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
                    <div style={{
                      width: 80, height: 80, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', background: '#f4f4f4', borderRadius: 6,
                    }}>
                      <IconPhotoOff size={24} color="#999" />
                    </div>
                  </Tooltip>
                )}
                <Text size="xs" ta="center" lineClamp={2} fw={500}>{p.title}</Text>
                {p.illustration_url ? (
                  <Badge size="xs" color="green" variant="light" leftSection={<IconPhoto size={10} />}>
                    OK
                  </Badge>
                ) : (
                  <Badge size="xs" color="orange" variant="light">
                    Manquante
                  </Badge>
                )}
              </Stack>
            </Paper>
          ))}
        </SimpleGrid>
      )}

      <Paper withBorder p="md" radius="md" bg="gray.0">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Opération rare. À lancer après avoir ajouté ou modifié des illustrations côté Shopify.
          </Text>
          <Button
            variant="light"
            color="gray"
            leftSection={<IconRefresh size={16} />}
            onClick={runSync}
            loading={syncing}
          >
            Resynchroniser depuis Shopify
          </Button>
        </Group>
      </Paper>
    </Stack>
  );
}
