'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Title, Text, Paper, Group, Stack, Badge, Image, Button,
  SimpleGrid, Loader, Center, Modal, ActionIcon,
} from '@mantine/core';
import { IconArchive, IconArrowBack, IconTrash, IconPhoto } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useShop } from '@/context/ShopContext';

interface ArchivedProduct {
  id: string;
  shopify_id: string;
  title: string;
  handle: string;
  image_url: string | null;
  product_type: string | null;
  synced_at: string;
  variants: Array<{
    id: string;
    title: string;
    sku: string;
    option1: string | null;
    option2: string | null;
    option3: string | null;
    shopify_active: boolean;
  }>;
}

export default function ArchivesPage() {
  const { currentShop } = useShop();
  const [products, setProducts] = useState<ArchivedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<ArchivedProduct | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchArchived = useCallback(async () => {
    if (!currentShop) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ shopId: currentShop.id });
      const response = await fetch(`/api/inventory/archive?${params}`);
      if (response.ok) {
        const data = await response.json();
        setProducts(data.products || []);
      }
    } catch (err) {
      console.error('Error fetching archived products:', err);
    } finally {
      setLoading(false);
    }
  }, [currentShop]);

  useEffect(() => {
    fetchArchived();
  }, [fetchArchived]);

  const handleRestore = async (product: ArchivedProduct) => {
    if (!currentShop) return;
    setRestoring(product.id);
    try {
      const params = new URLSearchParams({ productId: product.id, shopId: currentShop.id });
      const response = await fetch(`/api/inventory/archive?${params}`, { method: 'PATCH' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Erreur');
      }
      setProducts(prev => prev.filter(p => p.id !== product.id));
      notifications.show({
        title: 'Produit restauré',
        message: `${product.title} est maintenant visible dans l'inventaire`,
        color: 'green',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur';
      notifications.show({ title: 'Erreur', message, color: 'red' });
    } finally {
      setRestoring(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || !currentShop) return;
    setDeleting(true);
    try {
      const params = new URLSearchParams({ productId: deleteTarget.id, shopId: currentShop.id });
      const response = await fetch(`/api/inventory/archive?${params}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Erreur');
      }
      setProducts(prev => prev.filter(p => p.id !== deleteTarget.id));
      notifications.show({
        title: 'Produit supprimé',
        message: `${deleteTarget.title} a été supprimé définitivement`,
        color: 'green',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur';
      notifications.show({ title: 'Erreur', message, color: 'red' });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  if (loading) {
    return (
      <Center h={400}>
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <div>
      <Group justify="space-between" mb="xl">
        <Group gap="sm">
          <IconArchive size={24} />
          <Title order={2}>Archives</Title>
          <Badge size="lg" variant="light" color="gray">{products.length}</Badge>
        </Group>
      </Group>

      {products.length === 0 ? (
        <Center h={300}>
          <Stack align="center" gap="sm">
            <IconArchive size={48} color="var(--mantine-color-dimmed)" />
            <Text c="dimmed" size="lg">Aucun produit archivé</Text>
            <Text c="dimmed" size="sm">
              Les produits supprimés ou désactivés sur Shopify apparaîtront ici après une synchronisation.
            </Text>
          </Stack>
        </Center>
      ) : (
        <Stack gap="md">
          {products.map(product => (
            <Paper key={product.id} withBorder radius="md" p="md">
              <Group justify="space-between" wrap="nowrap">
                <Group gap="md" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                  {product.image_url ? (
                    <Image
                      src={product.image_url}
                      alt={product.title}
                      w={60}
                      h={60}
                      radius="sm"
                      fit="cover"
                    />
                  ) : (
                    <Center w={60} h={60} bg="gray.1" style={{ borderRadius: 'var(--mantine-radius-sm)' }}>
                      <IconPhoto size={24} color="var(--mantine-color-dimmed)" />
                    </Center>
                  )}
                  <Stack gap={2} style={{ minWidth: 0 }}>
                    <Text fw={600} truncate>{product.title}</Text>
                    <Group gap="xs">
                      {product.product_type && (
                        <Badge size="xs" variant="light" color="gray">
                          {product.product_type}
                        </Badge>
                      )}
                      <Text size="xs" c="dimmed">
                        {product.variants.length} variante{product.variants.length > 1 ? 's' : ''}
                      </Text>
                    </Group>
                  </Stack>
                </Group>

                <Group gap="xs" wrap="nowrap">
                  <Button
                    variant="light"
                    color="blue"
                    size="xs"
                    leftSection={<IconArrowBack size={14} />}
                    loading={restoring === product.id}
                    onClick={() => handleRestore(product)}
                  >
                    Restaurer
                  </Button>
                  <ActionIcon
                    variant="light"
                    color="red"
                    size="lg"
                    onClick={() => setDeleteTarget(product)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}

      {/* Modal de confirmation suppression */}
      <Modal
        opened={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={
          <Group gap="xs">
            <IconTrash size={20} color="var(--mantine-color-red-6)" />
            <Text fw={600}>Supprimer définitivement</Text>
          </Group>
        }
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Supprimer définitivement <Text span fw={600}>{deleteTarget?.title}</Text> et
            ses {deleteTarget?.variants.length} variante{(deleteTarget?.variants.length || 0) > 1 ? 's' : ''} ?
          </Text>
          <Text size="sm" c="dimmed">
            Tout le stock associé sera perdu. Cette action est irréversible.
          </Text>
          <Group justify="flex-end" gap="sm" mt="md">
            <Button variant="default" onClick={() => setDeleteTarget(null)}>
              Annuler
            </Button>
            <Button color="red" onClick={handleDelete} loading={deleting}>
              Supprimer
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
