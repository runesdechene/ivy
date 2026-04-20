'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Title, Text, Paper, Table, Button, Group,
  Checkbox, Loader, Center, Stack, Progress, ActionIcon, Tooltip
} from '@mantine/core';
import { IconArrowLeft, IconChecklist, IconCheckbox, IconSquare } from '@tabler/icons-react';
import { useShop } from '@/context/ShopContext';
import { getColorHex, isColorOption, loadColorMappingsFromSupabase, areColorMappingsLoaded } from '@/utils/color-transformer';
import { compareSizes } from '@/utils/size-helpers';
import { SortOptionsBar } from '@/components/Inventory/SortOptionsBar';
import { StatusBadge } from '@/components/StatusBadge';
import { SkuChip } from '@/components/SkuChip';
import styles from './feuillet.module.scss';

const SIZE_ORDER = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'];

interface OrderItem {
  id: string;
  variant_id: string | null;
  product_title: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  is_validated: boolean;
  validated_at: string | null;
  metafields?: Record<string, string>;
}

interface SupplierOrder {
  id: string;
  order_number: string;
  status: 'draft' | 'requested' | 'produced' | 'completed';
}

interface GroupedVariant {
  sku: string;
  color: string;
  size: string;
  items: OrderItem[];
  totalQuantity: number;
  validatedCount: number;
}

const STATUS_MAP: Record<string, { label: string; variant: 'moss' | 'clay' | 'sand' | 'slate' }> = {
  completed: { label: 'Terminée', variant: 'moss' },
  produced: { label: 'Produite', variant: 'sand' },
  requested: { label: 'Demandée', variant: 'clay' },
  draft: { label: 'Brouillon', variant: 'slate' },
};

export default function FeuilletCommandePage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.orderId as string;
  const { currentShop } = useShop();
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<SupplierOrder | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [sortOrder, setSortOrder] = useState<string[]>(['Couleur', 'Taille']);

  const fetchOrder = useCallback(async () => {
    if (!currentShop || !orderId) return;

    setLoading(true);
    try {
      if (!areColorMappingsLoaded()) {
        await loadColorMappingsFromSupabase(currentShop.id);
      }

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

  // Extraire couleur et taille du variant_title (format "Couleur / Taille")
  const parseVariantTitle = (variantTitle: string | null): { color: string; size: string } => {
    if (!variantTitle) return { color: 'Sans couleur', size: 'Sans taille' };
    const parts = variantTitle.split('/').map(p => p.trim());
    if (parts.length >= 2) {
      return { color: parts[parts.length - 2], size: parts[parts.length - 1] };
    }
    return { color: parts[0] || 'Sans couleur', size: 'Sans taille' };
  };

  // Grouper les items par SKU puis par couleur/taille
  const variantsBySku = useMemo(() => {
    const grouped = new Map<string, GroupedVariant[]>();

    items.forEach(item => {
      const sku = item.sku || 'Sans SKU';
      if (!grouped.has(sku)) {
        grouped.set(sku, []);
      }

      const { color, size } = parseVariantTitle(item.variant_title);
      const variants = grouped.get(sku)!;
      const existingGroup = variants.find(g => g.color === color && g.size === size);

      if (existingGroup) {
        existingGroup.items.push(item);
        existingGroup.totalQuantity++;
        if (item.is_validated) existingGroup.validatedCount++;
      } else {
        variants.push({
          sku,
          color,
          size,
          items: [item],
          totalQuantity: 1,
          validatedCount: item.is_validated ? 1 : 0,
        });
      }
    });

    // Trier chaque groupe selon sortOrder
    grouped.forEach((groups, sku) => {
      groups.sort((a, b) => {
        for (const criterion of sortOrder) {
          if (criterion === 'Taille') {
            const aIdx = SIZE_ORDER.indexOf(a.size.toUpperCase());
            const bIdx = SIZE_ORDER.indexOf(b.size.toUpperCase());
            let cmp = 0;
            if (aIdx !== -1 && bIdx !== -1) cmp = aIdx - bIdx;
            else if (aIdx !== -1) cmp = -1;
            else if (bIdx !== -1) cmp = 1;
            else cmp = a.size.localeCompare(b.size);
            if (cmp !== 0) return cmp;
          } else {
            const cmp = a.color.localeCompare(b.color);
            if (cmp !== 0) return cmp;
          }
        }
        return 0;
      });
      grouped.set(sku, groups);
    });

    return grouped;
  }, [items, sortOrder]);

  const totals = useMemo(() => {
    const total = items.length;
    const validated = items.filter(i => i.is_validated).length;
    const progress = total > 0 ? (validated / total) * 100 : 0;
    return { total, validated, progress };
  }, [items]);

  // Toggle validation d'un item
  const toggleValidation = async (itemId: string, validated: boolean) => {
    if (!currentShop) return;

    // Optimistic update
    setItems(prev => prev.map(item =>
      item.id === itemId
        ? { ...item, is_validated: validated, validated_at: validated ? new Date().toISOString() : null }
        : item
    ));

    try {
      const response = await fetch(`/api/suppliers/orders/${orderId}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: currentShop.id,
          itemId,
          is_validated: validated,
        }),
      });

      if (!response.ok) {
        // Revert on error
        setItems(prev => prev.map(item =>
          item.id === itemId
            ? { ...item, is_validated: !validated, validated_at: null }
            : item
        ));
      }
    } catch (err) {
      console.error('Error toggling validation:', err);
      setItems(prev => prev.map(item =>
        item.id === itemId
          ? { ...item, is_validated: !validated, validated_at: null }
          : item
      ));
    }
  };

  // Tout cocher/décocher pour un SKU
  const toggleAllForSku = async (sku: string, validate: boolean) => {
    const groups = variantsBySku.get(sku);
    if (!groups) return;

    const itemsToToggle = groups.flatMap(g => g.items).filter(i => i.is_validated !== validate);
    for (const item of itemsToToggle) {
      await toggleValidation(item.id, validate);
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
    <div className={styles.pageContainer}>
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
        <IconChecklist size={24} style={{ color: 'var(--slate-soft)' }} />
        <Title order={2} className={styles.orderNumber}>
          Feuillet de commande — {order.order_number}
        </Title>
        <StatusBadge variant={statusInfo.variant}>{statusInfo.label}</StatusBadge>
      </Group>

      <Text className={styles.subtitle} mb="lg">
        Suivi de production : cochez chaque article au fur et à mesure de la production.
      </Text>

      {/* Progression */}
      <div className={styles.progressCard} style={{ marginBottom: 'var(--mantine-spacing-lg)' }}>
        <Group justify="space-between" mb="xs">
          <Text fw={600} c="var(--slate)">Progression</Text>
          <Text size="sm" c="var(--slate-muted)">
            <span style={{ fontFamily: 'var(--font-inter)', fontStyle: 'normal', fontWeight: 600, fontSize: 16 }}>
              {totals.validated}
            </span>
            {' / '}
            <span style={{ fontFamily: 'var(--font-inter)', fontStyle: 'normal', fontWeight: 600, fontSize: 16 }}>
              {totals.total}
            </span>
            {' validé(s) ('}
            {Math.round(totals.progress)}%{')'}
          </Text>
        </Group>
        <Progress value={totals.progress} size="lg" color="var(--moss)" />
      </div>

      <SortOptionsBar options={sortOrder} onReorder={setSortOrder} />

      {variantsBySku.size === 0 ? (
        <Paper p="xl" className={styles.emptyCard}>
          <Text c="var(--slate-muted)" ta="center">
            Aucun article dans cette commande.
          </Text>
        </Paper>
      ) : (
        <Stack gap="lg">
          {Array.from(variantsBySku.entries())
            .sort(([skuA], [skuB]) => skuA.localeCompare(skuB))
            .map(([sku, groups]) => {
              const skuTotal = groups.reduce((sum, g) => sum + g.totalQuantity, 0);
              const skuValidated = groups.reduce((sum, g) => sum + g.validatedCount, 0);

              return (
                <Stack key={sku} gap="xs" className={styles.skuSection}>
                  <Group gap="sm">
                    <div className={styles.skuTitle}>
                      <SkuChip>{sku}</SkuChip>
                      <StatusBadge
                        variant={skuValidated === skuTotal ? 'moss' : 'slate'}
                      >
                        {skuValidated}/{skuTotal}
                      </StatusBadge>
                    </div>
                    <Tooltip label="Tout cocher">
                      <ActionIcon variant="subtle" size="sm" onClick={() => toggleAllForSku(sku, true)}
                        style={{ color: 'var(--moss)' }}
                      >
                        <IconCheckbox size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Tout décocher">
                      <ActionIcon variant="subtle" size="sm" onClick={() => toggleAllForSku(sku, false)}
                        style={{ color: 'var(--slate-muted)' }}
                      >
                        <IconSquare size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>

                  <div className={styles.tableContainer}>
                    <Table>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th style={{
                            width: 1, whiteSpace: 'nowrap',
                            fontFamily: 'var(--font-inter)', fontSize: 11,
                            fontWeight: 600, textTransform: 'uppercase',
                            letterSpacing: '0.18em', color: 'var(--slate-muted)'
                          }}>
                            Variante
                          </Table.Th>
                          <Table.Th style={{
                            fontFamily: 'var(--font-inter)', fontSize: 11,
                            fontWeight: 600, textTransform: 'uppercase',
                            letterSpacing: '0.18em', color: 'var(--slate-muted)'
                          }}>
                            Validé
                          </Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {groups.map(group => {
                          const colorHex = getColorHex(group.color);
                          const hasKnownColor = colorHex !== '#808080';

                          return (
                            <Table.Tr
                              key={`${group.sku}-${group.color}-${group.size}`}
                              className={styles.tableRow}
                            >
                              <Table.Td style={{ whiteSpace: 'nowrap' }}>
                                <Group gap="xs" wrap="nowrap">
                                  {hasKnownColor && (
                                    <div
                                      style={{
                                        width: 14,
                                        height: 14,
                                        borderRadius: '50%',
                                        background: colorHex,
                                        border: '1px solid var(--divider-strong)',
                                        flexShrink: 0,
                                      }}
                                    />
                                  )}
                                  <Text size="sm" fw={500} c="var(--slate)">
                                    {sortOrder[0] === 'Taille'
                                      ? `${group.size} — ${group.color}`
                                      : `${group.color} — ${group.size}`}
                                  </Text>
                                  <span className={styles.quantity}>
                                    {group.totalQuantity}
                                  </span>
                                </Group>
                              </Table.Td>
                              <Table.Td>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {group.items.map((item) => (
                                    <Checkbox
                                      key={item.id}
                                      checked={item.is_validated}
                                      onChange={(e) => toggleValidation(item.id, e.currentTarget.checked)}
                                      size="sm"
                                      color="var(--moss)"
                                    />
                                  ))}
                                </div>
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </div>
                </Stack>
              );
            })}
        </Stack>
      )}

      {totals.validated === totals.total && totals.total > 0 && (
        <Paper p="md" className={styles.completionCard} mt="lg">
          <Group justify="center">
            <IconCheckbox size={20} style={{ color: 'var(--moss)' }} />
            <Text fw={600} c="var(--moss)">Tous les articles sont validés !</Text>
          </Group>
        </Paper>
      )}
    </div>
  );
}
