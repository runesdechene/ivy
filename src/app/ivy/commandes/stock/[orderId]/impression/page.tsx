'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Title, Text, Paper, Button, Group, Checkbox, Loader, Center, Progress, SimpleGrid, Stack, Divider, Modal, Image, Tooltip } from '@mantine/core';
import { IconArrowLeft, IconPrinter, IconCheck, IconPackage, IconPhotoOff } from '@tabler/icons-react';
import { useShop } from '@/context/ShopContext';
import { getColorHex, loadColorMappingsFromSupabase } from '@/utils/color-transformer';
import { SortOptionsBar } from '@/components/Inventory/SortOptionsBar';
import { StatusBadge } from '@/components/StatusBadge';
import { SkuChip } from '@/components/SkuChip';
import { MetaChip } from '@/components/MetaChip';
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

const STATUS_MAP: Record<string, { label: string; variant: 'moss' | 'clay' | 'sand' | 'slate' }> = {
  completed: { label: 'Terminée', variant: 'moss' },
  produced: { label: 'Produite', variant: 'sand' },
  requested: { label: 'Demandée', variant: 'clay' },
  draft: { label: 'Brouillon', variant: 'slate' },
};

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
        <Loader size="lg" color="var(--moss)" />
      </Center>
    );
  }

  if (!order) {
    return (
      <Center h={400}>
        <Text c="var(--slate-muted)">Commande non trouvée</Text>
      </Center>
    );
  }

  const statusInfo = STATUS_MAP[order.status] || STATUS_MAP.draft;

  return (
    <div className={styles.container}>
      {/* Header */}
      <Group justify="space-between" mb="lg" className={styles.noPrint}>
        <Group>
          <Button
            variant="subtle"
            color="gray"
            leftSection={<IconArrowLeft size={18} />}
            onClick={() => router.push(`/ivy/commandes/stock/${orderId}`)}
          >
            Retour
          </Button>
        </Group>
      </Group>

      <Group gap="sm" mb="xs" className={styles.header}>
        <IconPrinter size={24} style={{ color: 'var(--slate-soft)' }} />
        <Title order={2} className={styles.orderNumber}>
          Feuille d&apos;impression — {order.order_number}
        </Title>
        <StatusBadge variant={statusInfo.variant}>{statusInfo.label}</StatusBadge>
      </Group>

      <Text className={styles.subtitle} mb="lg">
        Vue détaillée pour l&apos;atelier. Chaque vignette représente une variante à produire avec ses métachamps.
      </Text>

      {skuGroups.length === 0 ? (
        <Paper p="xl" className={styles.emptyCard}>
          <Text c="var(--slate-muted)" ta="center">
            Aucun article validé à imprimer. Validez d&apos;abord les articles sur la page de commande.
          </Text>
        </Paper>
      ) : (
        <>
          {/* Progression d'impression */}
          <div className={styles.progressCard} style={{ marginBottom: 'var(--mantine-spacing-lg)' }}>
            <Group justify="space-between" mb="xs">
              <Text fw={600} c="var(--slate)">Progression d&apos;impression</Text>
              <Text size="sm" c="var(--slate-muted)">
                <span style={{ fontFamily: 'var(--font-fraunces)', fontStyle: 'italic', fontSize: 16 }}>
                  {totals.printed}
                </span>
                {' / '}
                <span style={{ fontFamily: 'var(--font-fraunces)', fontStyle: 'italic', fontSize: 16 }}>
                  {totals.total}
                </span>
                {' imprimé(s) ('}
                {Math.round(totals.progress)}%{')'}
              </Text>
            </Group>
            <Progress value={totals.progress} size="lg" color="var(--moss)" />
          </div>

          {/* Tri par drag & drop */}
          <Paper p="sm" style={{ background: 'var(--cream-soft)', border: '1px solid var(--divider)', borderRadius: 'var(--mantine-radius-md)', marginBottom: 'var(--mantine-spacing-md)' }}>
            <SortOptionsBar options={sortOrder} onReorder={setSortOrder} />
          </Paper>

          {/* Vignettes groupées par SKU */}
          {skuGroups.map(({ prefix, groups }) => (
            <div key={prefix}>
              <Group gap="xs" mb="sm" mt="md" className={styles.skuGroupHeader}>
                <IconPackage size={20} style={{ color: 'var(--slate)' }} />
                <Text fw={600} size="lg" c="var(--slate)">{prefix}</Text>
                <StatusBadge variant="sand">
                  {groups.reduce((sum, g) => sum + g.quantity, 0)} article(s)
                </StatusBadge>
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="md" mb="lg">
                {groups.map((group) => {
                  const allPrinted = group.printedCount === group.quantity;
                  const allOptions = group.variant_title?.split('/').map(part => part.trim()).filter(Boolean) || [];

                  return (
                    <Paper
                      key={group.key}
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
                              color="var(--moss)"
                            />
                            <span style={{
                              fontFamily: 'var(--font-fraunces)',
                              fontStyle: 'italic',
                              fontSize: 22,
                              fontWeight: 500,
                              color: allPrinted ? 'var(--moss)' : 'var(--clay)',
                            }}>
                              x{group.quantity}
                            </span>
                          </Group>
                          {allPrinted && <IconCheck size={20} style={{ color: 'var(--moss)' }} />}
                        </Group>

                        <Divider color="var(--divider)" />

                        <Group gap="sm" wrap="nowrap" align="flex-start">
                          {group.illustrationUrl ? (
                            <Image
                              src={group.illustrationUrl}
                              alt={group.product_title}
                              w={96}
                              h={96}
                              fit="contain"
                              radius="sm"
                              className={styles.illustrationImage}
                              onClick={(e) => {
                                e.stopPropagation();
                                setZoomedImage({ url: group.illustrationUrl!, title: group.product_title });
                              }}
                            />
                          ) : (
                            <Tooltip label="Illustration manquante — synchroniser dans Paramètres > Illustrations">
                              <div className={styles.illustrationPlaceholder}>
                                <IconPhotoOff size={28} style={{ color: 'var(--slate-muted)' }} />
                              </div>
                            </Tooltip>
                          )}

                          <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
                            <Text fw={600} size="sm" lineClamp={2} c="var(--slate)">
                              {group.product_title}
                            </Text>

                            <SkuChip>{group.sku || 'Sans SKU'}</SkuChip>

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
                                          border: '1px solid var(--divider-strong)',
                                        }}
                                      />
                                      <Text size="sm" c="var(--slate)">{option}</Text>
                                    </Group>
                                  );
                                }
                                if (idx === allOptions.length - 1 && /^(XXXS|XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL|\d+)$/i.test(option)) {
                                  return (
                                    <StatusBadge key={idx} variant="clay">
                                      {option}
                                    </StatusBadge>
                                  );
                                }
                                return (
                                  <StatusBadge key={idx} variant="slate">
                                    {option}
                                  </StatusBadge>
                                );
                              })}
                            </Group>
                          </Stack>
                        </Group>

                        {Object.keys(group.metafields).length > 0 && (
                          <div className={styles.metaSection}>
                            <Text size="xs" fw={600} c="var(--slate-muted)" mb={4}
                              style={{ fontFamily: 'var(--font-inter)', textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: 10 }}
                            >
                              Métachamps
                            </Text>
                            <Group gap={6} wrap="wrap">
                              {Object.entries(group.metafields).map(([key, value]) => (
                                <MetaChip key={key} keyName={key} value={value} />
                              ))}
                            </Group>
                          </div>
                        )}

                        {group.quantity > 1 && (
                          <>
                            <Divider color="var(--divider)" />
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
                                  color="var(--moss)"
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
            <Paper p="md" className={styles.completionCard} mt="lg">
              <Group justify="center">
                <IconCheck size={20} style={{ color: 'var(--moss)' }} />
                <Text fw={600} c="var(--moss)">Tous les articles ont été imprimés !</Text>
              </Group>
            </Paper>
          )}
        </>
      )}

      <Modal
        opened={!!zoomedImage}
        onClose={() => setZoomedImage(null)}
        title={
          <Text fw={600} c="var(--slate)" style={{ fontFamily: 'var(--font-fraunces)', fontStyle: 'italic' }}>
            {zoomedImage?.title || ''}
          </Text>
        }
        size="xl"
        centered
        styles={{
          content: { background: 'var(--cream-soft)' },
          header: { background: 'var(--cream-soft)', borderBottom: '1px solid var(--divider)' },
          overlay: { background: 'rgba(244, 240, 232, 0.7)' },
        }}
      >
        {zoomedImage && (
          <Image src={zoomedImage.url} alt={zoomedImage.title} fit="contain" />
        )}
      </Modal>
    </div>
  );
}
