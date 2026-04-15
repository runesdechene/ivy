'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Title, Text, Paper, Button, Group, Badge, Checkbox, Loader, Center, Progress, SimpleGrid, Stack, Divider, Modal, Image, Tooltip } from '@mantine/core';
import { IconArrowLeft, IconPrinter, IconCheck, IconPackage, IconPhotoOff } from '@tabler/icons-react';
import { useShop } from '@/context/ShopContext';
import { getColorHex, loadColorMappingsFromSupabase } from '@/utils/color-transformer';
import { SortOptionsBar } from '@/components/Inventory/SortOptionsBar';
import styles from './impression.module.scss';

interface OrderItem {
  id: string;
  variant_id: string | null;
  product_title: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  is_validated: boolean;
  validated_at: string | null;
  is_printed: boolean;
  printed_at: string | null;
  metafields?: Record<string, string>;
  illustration_url?: string | null;
}

interface SupplierOrder {
  id: string;
  order_number: string;
  status: 'draft' | 'requested' | 'produced' | 'completed';
  note: string | null;
  created_at: string;
}

const SIZE_ORDER = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'];

function getSizeIndex(size: string | null | undefined): number {
  if (!size) return 999;
  const upperSize = size.toUpperCase();
  const index = SIZE_ORDER.indexOf(upperSize);
  return index === -1 ? 999 : index;
}

export default function FeuilleImpressionPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.orderId as string;
  const { currentShop } = useShop();
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<SupplierOrder | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);

  const [sortOrder, setSortOrder] = useState<string[]>(['Nom', 'Couleur', 'Taille']);
  const [zoomedImage, setZoomedImage] = useState<{ url: string; title: string } | null>(null);

  // Charger la commande et ses articles
  const fetchOrder = useCallback(async () => {
    if (!currentShop || !orderId) return;
    
    setLoading(true);
    try {
      // Charger les mappings de couleurs
      await loadColorMappingsFromSupabase(currentShop.id);
      
      const response = await fetch(`/api/suppliers/orders/${orderId}?shopId=${currentShop.id}`);
      if (response.ok) {
        const data = await response.json();
        setOrder(data.order);
        setItems(data.items || []);
      } else {
        router.push('/ivy/commandes/stock');
      }
    } catch (err) {
      console.error('Error fetching order:', err);
      router.push('/ivy/commandes/stock');
    } finally {
      setLoading(false);
    }
  }, [currentShop, orderId, router]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  // Grouper les articles par SKU prefix, puis par produit/variante
  // Ne garder que les articles validés (is_validated = true)
  const skuGroups = useMemo(() => {
    const variantGroups: Record<string, OrderItem[]> = {};

    const validatedItems = items.filter(item => item.is_validated);

    validatedItems.forEach(item => {
      const key = `${item.product_title}|${item.variant_title}|${item.sku}`;
      if (!variantGroups[key]) {
        variantGroups[key] = [];
      }
      variantGroups[key].push(item);
    });

    const extractOptions = (variantTitle: string | null) => {
      const parts = (variantTitle || '').split(' / ');
      const color = parts.find(p => getSizeIndex(p.trim()) === 999) || '';
      const size = parts.find(p => getSizeIndex(p.trim()) !== 999) || '';
      return { color, size };
    };

    type VariantGroup = {
      key: string;
      items: OrderItem[];
      product_title: string;
      variant_title: string | null;
      sku: string | null;
      metafields: Record<string, string>;
      quantity: number;
      printedCount: number;
      illustrationUrl: string | null;
    };

    const compareByCriterion = (a: VariantGroup, b: VariantGroup, criterion: string): number => {
      switch (criterion) {
        case 'Nom':
          return (a.product_title || '').localeCompare(b.product_title || '', 'fr');
        case 'Couleur':
          return extractOptions(a.variant_title).color.localeCompare(extractOptions(b.variant_title).color, 'fr');
        case 'Taille':
          return getSizeIndex(extractOptions(a.variant_title).size) - getSizeIndex(extractOptions(b.variant_title).size);
        default:
          return 0;
      }
    };

    // Convertir en variant groups triés
    const allVariantGroups: VariantGroup[] = Object.entries(variantGroups)
      .map(([key, groupItems]) => ({
        key,
        items: groupItems,
        product_title: groupItems[0].product_title,
        variant_title: groupItems[0].variant_title,
        sku: groupItems[0].sku,
        metafields: groupItems[0].metafields || {},
        quantity: groupItems.length,
        printedCount: groupItems.filter(i => i.is_printed).length,
        illustrationUrl: groupItems[0].illustration_url || null,
      }));

    // Grouper par préfixe SKU
    const byPrefix: Record<string, VariantGroup[]> = {};
    allVariantGroups.forEach(vg => {
      const prefix = vg.sku?.match(/^([A-Za-z]+)/)?.[1]?.toUpperCase() || 'AUTRES';
      if (!byPrefix[prefix]) byPrefix[prefix] = [];
      byPrefix[prefix].push(vg);
    });

    // Trier chaque groupe SKU selon les critères drag & drop
    Object.keys(byPrefix).forEach(prefix => {
      byPrefix[prefix].sort((a, b) => {
        for (const criterion of sortOrder) {
          const cmp = compareByCriterion(a, b, criterion);
          if (cmp !== 0) return cmp;
        }
        return 0;
      });
    });

    // Retourner trié par préfixe alphabétique
    return Object.entries(byPrefix)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([prefix, groups]) => ({ prefix, groups }));
  }, [items, sortOrder]);

  const totals = useMemo(() => {
    // Compter uniquement les articles validés
    const validatedItems = items.filter(i => i.is_validated);
    const total = validatedItems.length;
    const printed = validatedItems.filter(i => i.is_printed).length;
    return {
      total,
      printed,
      progress: total > 0 ? (printed / total) * 100 : 0,
    };
  }, [items]);

  // Marquer un article comme imprimé ou non
  const togglePrinted = async (itemId: string, printed: boolean) => {
    if (!currentShop || !orderId) return;
    
    try {
      const response = await fetch(`/api/suppliers/orders/${orderId}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: currentShop.id,
          itemId,
          is_printed: printed,
        }),
      });
      
      if (response.ok) {
        setItems(prev => prev.map(item => 
          item.id === itemId 
            ? { ...item, is_printed: printed, printed_at: printed ? new Date().toISOString() : null }
            : item
        ));
      }
    } catch (err) {
      console.error('Error toggling printed:', err);
    }
  };

  // Marquer tous les articles d'un groupe comme imprimés ou non
  const toggleGroupPrinted = async (groupItems: OrderItem[], printed: boolean) => {
    for (const item of groupItems) {
      if (item.is_printed !== printed) {
        await togglePrinted(item.id, printed);
      }
    }
  };

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

  return (
    <div className={styles.container}>
      {/* Header */}
      <Group justify="space-between" mb="lg">
        <Group>
          <Button
            variant="subtle"
            color="gray"
            leftSection={<IconArrowLeft size={18} />}
            onClick={() => router.push(`/ivy/commandes/stock/${orderId}`)}
          >
            Retour
          </Button>
          <IconPrinter size={28} />
          <Title order={2}>Feuille d'impression - {order.order_number}</Title>
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
        </Group>
      </Group>

      <Text c="dimmed" mb="lg">
        Vue détaillée pour l'atelier. Chaque vignette représente une variante à produire avec ses métachamps.
      </Text>

      {skuGroups.length === 0 ? (
        <Paper withBorder p="xl" radius="md">
          <Text c="dimmed" ta="center">
            Aucun article validé à imprimer. Validez d'abord les articles sur la page de commande.
          </Text>
        </Paper>
      ) : (
        <>
          {/* Progression d'impression */}
          <Paper withBorder p="md" radius="md" mb="lg">
            <Group justify="space-between" mb="xs">
              <Text fw={600}>Progression d'impression</Text>
              <Text size="sm" c="dimmed">
                {totals.printed} / {totals.total} imprimé(s) ({Math.round(totals.progress)}%)
              </Text>
            </Group>
            <Progress value={totals.progress} size="lg" color="teal" />
          </Paper>

          {/* Tri par drag & drop */}
          <Paper withBorder p="sm" radius="md" mb="md">
            <SortOptionsBar options={sortOrder} onReorder={setSortOrder} />
          </Paper>

          {/* Vignettes groupées par SKU */}
          {skuGroups.map(({ prefix, groups }) => (
            <div key={prefix}>
              <Group gap="xs" mb="sm" mt="md" className={styles.skuGroupHeader}>
                <IconPackage size={20} />
                <Text fw={600} size="lg">{prefix}</Text>
                <Badge variant="light">{groups.reduce((sum, g) => sum + g.quantity, 0)} article(s)</Badge>
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="md" mb="lg">
                {groups.map((group) => {
                  const allPrinted = group.printedCount === group.quantity;
                  const allOptions = group.variant_title?.split('/').map(part => part.trim()).filter(Boolean) || [];

                  return (
                    <Paper
                      key={group.key}
                      withBorder
                      radius="md"
                      p="md"
                      className={allPrinted ? styles.validatedCard : styles.card}
                      onClick={() => toggleGroupPrinted(group.items, !allPrinted)}
                      style={{ cursor: 'pointer' }}
                    >
                      <Stack gap="xs">
                        <Group justify="space-between">
                          <Group gap="xs">
                            <Checkbox
                              checked={allPrinted}
                              onChange={(e) => {
                                e.stopPropagation();
                                toggleGroupPrinted(group.items, e.currentTarget.checked);
                              }}
                              size="md"
                              color="teal"
                            />
                            <Badge
                              size="lg"
                              variant={allPrinted ? 'filled' : 'light'}
                              color={allPrinted ? 'teal' : 'orange'}
                            >
                              x{group.quantity}
                            </Badge>
                          </Group>
                          {allPrinted && <IconCheck size={20} color="teal" />}
                        </Group>

                        <Divider />

                        {group.illustrationUrl ? (
                          <Image
                            src={group.illustrationUrl}
                            alt={group.product_title}
                            h={140}
                            fit="contain"
                            radius="sm"
                            style={{ cursor: 'zoom-in', background: '#fafafa' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setZoomedImage({ url: group.illustrationUrl!, title: group.product_title });
                            }}
                          />
                        ) : (
                          <Tooltip label="Illustration manquante — synchroniser dans Paramètres → Illustrations">
                            <div style={{
                              height: 140, display: 'flex', alignItems: 'center',
                              justifyContent: 'center', background: '#f4f4f4', borderRadius: 6,
                            }}>
                              <IconPhotoOff size={32} color="#999" />
                            </div>
                          </Tooltip>
                        )}

                        <Text fw={600} size="sm" lineClamp={2}>
                          {group.product_title}
                        </Text>

                        <Badge variant="light" color="gray" size="sm">
                          {group.sku || 'Sans SKU'}
                        </Badge>

                        <Group gap="xs" wrap="wrap">
                          {allOptions.map((option, idx) => {
                            const colorHex = getColorHex(option);
                            if (colorHex && colorHex !== '#808080') {
                              return (
                                <Group key={idx} gap={4}>
                                  <div
                                    style={{
                                      width: 16,
                                      height: 16,
                                      borderRadius: '50%',
                                      background: colorHex,
                                      border: '1px solid #ddd',
                                    }}
                                  />
                                  <Text size="sm">{option}</Text>
                                </Group>
                              );
                            }
                            if (idx === allOptions.length - 1 && /^(XXXS|XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL|\d+)$/i.test(option)) {
                              return (
                                <Badge key={idx} variant="filled" color="blue" size="lg">
                                  {option}
                                </Badge>
                              );
                            }
                            return (
                              <Badge key={idx} variant="light" color="gray" size="sm">
                                {option}
                              </Badge>
                            );
                          })}
                        </Group>

                        {Object.keys(group.metafields).length > 0 && (
                          <>
                            <Divider label="Métachamps" labelPosition="center" />
                            <Stack gap={4}>
                              {Object.entries(group.metafields).map(([key, value]) => (
                                <Group key={key} justify="space-between">
                                  <Text size="xs" c="dimmed">{key}</Text>
                                  <Badge variant="light" color="violet" size="sm">
                                    {value}
                                  </Badge>
                                </Group>
                              ))}
                            </Stack>
                          </>
                        )}

                        {group.quantity > 1 && (
                          <>
                            <Divider label="Impression" labelPosition="center" />
                            <Group gap={4} wrap="wrap">
                              {group.items.map((item, idx) => (
                                <Checkbox
                                  key={item.id}
                                  checked={item.is_printed}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    togglePrinted(item.id, e.currentTarget.checked);
                                  }}
                                  size="xs"
                                  color="teal"
                                  label={`#${idx + 1}`}
                                />
                              ))}
                            </Group>
                          </>
                        )}
                      </Stack>
                    </Paper>
                  );
                })}
              </SimpleGrid>
            </div>
          ))}

          {totals.printed === totals.total && totals.total > 0 && (
            <Paper withBorder p="md" radius="md" bg="teal.0" mt="lg">
              <Group justify="center">
                <IconCheck size={20} color="teal" />
                <Text fw={600} c="teal">Tous les articles ont été imprimés !</Text>
              </Group>
            </Paper>
          )}
        </>
      )}

      <Modal
        opened={!!zoomedImage}
        onClose={() => setZoomedImage(null)}
        title={zoomedImage?.title || ''}
        size="xl"
        centered
      >
        {zoomedImage && (
          <Image src={zoomedImage.url} alt={zoomedImage.title} fit="contain" />
        )}
      </Modal>
    </div>
  );
}
