'use client';

import { Loader, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useDetailedOrdersPagePresenter, type OrderProgress } from './DetailedOrdersPage.presenter';
import { clsx } from 'clsx';
import { OrderDrawer } from '@/components/OrderDrawer/OrderDrawer';
import { VariantCheckbox } from '@/components/VariantCheckbox';
import { StatusBadge } from '@/components/StatusBadge';
import { TagPill } from '@/components/TagPill';
import { MetaChip } from '@/components/MetaChip';
import { SkuChip } from '@/components/SkuChip';
import { FilterChip } from '@/components/FilterChip';
import { ProductThumbnail } from '@/components/ProductThumbnail';
import { CostDisplay } from '@/components/CostDisplay';
import styles from './DetailedOrdersPage.module.scss';
import { transformColor, getColorHex, loadColorMappingsFromSupabase } from '@/utils/color-transformer';
import {
  generateVariantId,
  getSelectedOptions,
  getColorFromVariant,
  getSizeFromVariant,
} from '@/utils/variant-helpers';
import { encodeFirestoreId } from '@/utils/firebase-helpers';
import { formatDate } from '@/utils/date-helpers';
import { EXCLUDED_TAGS } from '@/config/excluded-tags';
import {
  IconPrinter,
  IconDots,
  IconCheck,
  IconArrowsSort,
  IconAlertTriangle,
} from '@tabler/icons-react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ShopifyOrder } from '@/types/shopify';
import * as ordersService from '@/supabase/services/orders';
import { useShop } from '@/context/ShopContext';

interface MetafieldConfig {
  namespace: string;
  key: string;
  display_name: string;
}

type FilterMode = 'all' | 'production' | 'toValidate' | 'ready';

const EXCLUDED_TAGS_LC = (EXCLUDED_TAGS as readonly string[]).map((t) => t.toLowerCase());

function formatEuro(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} €`;
}

function getDaysSince(createdAt: string): number {
  const orderDate = new Date(createdAt);
  const today = new Date();
  const diffTime = Math.abs(today.getTime() - orderDate.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// ItemRow
// ---------------------------------------------------------------------------

interface ItemRowProps {
  order: ShopifyOrder;
  item: NonNullable<ShopifyOrder['lineItems']>[number];
  index: number;
  metafieldConfigs: MetafieldConfig[];
}

function ItemRow({ order, item, index, metafieldConfigs }: ItemRowProps) {
  const color = getColorFromVariant(item);
  const size = getSizeFromVariant(item);
  const selectedOptions = getSelectedOptions(item);
  const variantLabel = item.variantTitle
    ? item.variantTitle
        .split(' / ')
        .map((v) => transformColor(v))
        .join(' / ')
    : '';
  const colorHex = color ? getColorHex(color) : '#cccccc';

  // Filter metafields by configured ones; exclude empty values
  const visibleMetafields = useMemo(() => {
    const metafields = item.variant?.metafields ?? [];
    if (metafields.length === 0 || metafieldConfigs.length === 0) return [];
    return metafields
      .filter((mf) =>
        metafieldConfigs.some((cfg) => cfg.namespace === mf.namespace && cfg.key === mf.key),
      )
      .map((mf) => {
        const config = metafieldConfigs.find(
          (cfg) => cfg.namespace === mf.namespace && cfg.key === mf.key,
        );
        return {
          keyName: config?.display_name || mf.key,
          value: mf.value,
        };
      })
      .filter((mf) => mf.value && mf.value.trim() !== '');
  }, [item.variant?.metafields, metafieldConfigs]);

  return (
    <div
      className={clsx(styles.item, { [styles.cancelled]: item.isCancelled })}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.itemCheck}>
        {Array.from({ length: item.quantity }).map((_, quantityIndex) => {
          const variantId = generateVariantId(
            encodeFirestoreId(order.id),
            item.sku || '',
            color,
            size,
            index,
            quantityIndex,
            selectedOptions,
          );
          return (
            <VariantCheckbox
              key={variantId}
              orderId={encodeFirestoreId(order.id)}
              sku={item.sku || ''}
              color={color}
              size={size}
              quantity={1}
              productIndex={index}
              quantityIndex={quantityIndex}
              variantId={variantId}
              disabled={!!item.isCancelled}
            />
          );
        })}
      </div>

      <ProductThumbnail
        imageUrl={item.image?.url ?? null}
        variantColor={color || null}
        size={54}
        alt={item.image?.altText || item.title}
      />

      <div className={styles.itemInfo}>
        <div className={styles.itemName}>{item.title}</div>
        <div className={styles.itemMeta}>
          {item.sku && <SkuChip>{item.sku}</SkuChip>}
          {variantLabel && (
            <span className={styles.variant}>
              <span
                className={styles.variantDot}
                style={{ background: colorHex }}
              />
              {variantLabel}
            </span>
          )}
          <span className={styles.qtyPill}>×{item.quantity}</span>
        </div>
        {visibleMetafields.length > 0 && (
          <div className={styles.itemMeta}>
            {visibleMetafields.map((mf, i) => (
              <MetaChip
                key={`${mf.keyName}-${i}`}
                keyName={mf.keyName}
                value={String(mf.value)}
              />
            ))}
          </div>
        )}
      </div>

      <CostDisplay qty={item.quantity} unitCost={item.unitCost ?? null} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// OrderCard
// ---------------------------------------------------------------------------

interface OrderCardProps {
  order: ShopifyOrder;
  progress: OrderProgress;
  metafieldConfigs: MetafieldConfig[];
  onOpen: () => void;
}

function OrderCard({ order, progress, metafieldConfigs, onOpen }: OrderCardProps) {
  const [isMarkingAsFulfilled, setIsMarkingAsFulfilled] = useState(false);
  const [kebabOpen, setKebabOpen] = useState(false);
  const kebabRef = useRef<HTMLDivElement | null>(null);
  const { currentShop } = useShop();

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

  const handleMarkAsFulfilled = (e: React.MouseEvent) => {
    e.stopPropagation();
    setKebabOpen(false);
    modals.openConfirmModal({
      title: 'Marquer comme expédié',
      children: (
        <Text size="sm">
          Êtes-vous sûr de vouloir marquer la commande <strong>{order.name}</strong> comme
          expédiée ?
          <br />
          <br />
          Cette action changera son statut à "FULFILLED" et la fera disparaître de cette page.
        </Text>
      ),
      labels: { confirm: 'Marquer comme expédié', cancel: 'Annuler' },
      confirmProps: { color: 'green' },
      onConfirm: async () => {
        setIsMarkingAsFulfilled(true);
        try {
          if (!currentShop) throw new Error('No shop selected');
          await ordersService.markOrderAsFulfilled(currentShop.id, order.id);
          notifications.show({
            title: 'Succès',
            message: `La commande ${order.name} a été marquée comme expédiée`,
            color: 'green',
          });
        } catch (error) {
          console.error('Erreur lors du marquage:', error);
          notifications.show({
            title: 'Erreur',
            message: 'Impossible de marquer la commande comme expédiée',
            color: 'red',
          });
        } finally {
          setIsMarkingAsFulfilled(false);
        }
      },
    });
  };

  const items = order.lineItems ?? [];
  const itemCount = items.reduce(
    (sum, it) => sum + (it.isCancelled ? 0 : it.quantity),
    0,
  );
  const totalCost = items.reduce((sum, it) => {
    if (it.isCancelled) return sum;
    const unit = typeof it.unitCost === 'number' ? it.unitCost : 0;
    return sum + unit * it.quantity;
  }, 0);

  const visibleTags = (order.tags ?? []).filter(
    (t) => !EXCLUDED_TAGS_LC.includes(t.toLowerCase()),
  );

  const financial = order.displayFinancialStatus?.toLowerCase();
  const days = getDaysSince(order.createdAt);
  const validatedPct =
    progress.totalCount > 0
      ? Math.round((progress.checkedCount / progress.totalCount) * 100)
      : 0;

  const daysClass =
    days <= 7 ? styles.daysRecent : days <= 14 ? styles.daysMedium : styles.daysOld;

  return (
    <div className={styles.card} onClick={onOpen} role="button" tabIndex={0}>
      <div className={styles.cardHead}>
        <div className={styles.cardHeadTop}>
          <div className={styles.orderNum}>{order.name}</div>
          {visibleTags.map((tag) => (
            <TagPill key={tag}>{tag}</TagPill>
          ))}
          <div className={styles.cardHeadRight}>
            {financial === 'paid' && <StatusBadge variant="moss">Payée</StatusBadge>}
            {financial === 'pending' && <StatusBadge variant="clay">En attente</StatusBadge>}
            {financial === 'partially_refunded' && (
              <StatusBadge variant="clay">Remboursé partiel</StatusBadge>
            )}
            {order.cancelledAt && <StatusBadge variant="plum">Annulée</StatusBadge>}
          </div>
        </div>
        <div className={styles.cardHeadBottom}>
          <span className={styles.date}>{formatDate(order.createdAt)}</span>
          <span className={clsx(styles.daysBadge, daysClass)}>
            {days}j
          </span>
          <div className={styles.costSummary}>
            <span className={styles.costSummaryLabel}>Coût</span>
            <span className={styles.costSummaryAmount}>{formatEuro(totalCost)}</span>
            <span className={styles.costSummaryUnit}>· {itemCount} art.</span>
          </div>
        </div>
      </div>

      <div className={styles.cardBody}>
        {items.length === 0 ? (
          <div className={styles.emptyState}>Aucun article</div>
        ) : (
          items.map((item, index) => (
            <ItemRow
              key={item.id}
              order={order}
              item={item}
              index={index}
              metafieldConfigs={metafieldConfigs}
            />
          ))
        )}
      </div>

      {order.note && <div className={styles.noteAlert}>{order.note}</div>}

      <div className={styles.cardFoot}>
        <div className={styles.progressWrap}>
          <span className={styles.progressLabel}>{validatedPct}%</span>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{ width: `${validatedPct}%` }}
            />
          </div>
        </div>
        <div className={styles.footRight} ref={kebabRef}>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={(e) => {
              e.stopPropagation();
              notifications.show({
                title: 'Feuillet',
                message: "Le feuillet d'impression n'est pas encore disponible pour les commandes boutique.",
                color: 'gray',
              });
            }}
          >
            <IconPrinter size={14} /> Feuillet
          </button>
          <button
            type="button"
            className={styles.btnKebab}
            onClick={(e) => {
              e.stopPropagation();
              setKebabOpen((v) => !v);
            }}
            aria-label="Actions"
          >
            <IconDots size={14} />
          </button>
          {kebabOpen && (
            <div className={styles.kebabMenu} onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={styles.kebabItem}
                onClick={handleMarkAsFulfilled}
                disabled={isMarkingAsFulfilled}
              >
                <IconCheck size={14} /> Marquer comme expédié
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function DetailedOrdersPage() {
  const {
    pendingOrders,
    progressByOrder,
    selectedOrder,
    isDrawerOpen,
    onSelectOrder,
    onCloseDrawer,
    isLoading,
    isReversed,
    toggleOrder,
  } = useDetailedOrdersPagePresenter();

  const { currentShop } = useShop();
  const [printerNotes, setPrinterNotes] = useState<string[]>([]);
  const [metafieldConfigs, setMetafieldConfigs] = useState<MetafieldConfig[]>([]);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');

  const fetchSettings = useCallback(async () => {
    if (!currentShop) return;
    try {
      await loadColorMappingsFromSupabase(currentShop.id);

      const [orderSettingsRes, metafieldsRes] = await Promise.all([
        fetch(`/api/settings/orders?shopId=${currentShop.id}`),
        fetch(`/api/settings/metafields?shopId=${currentShop.id}`),
      ]);

      if (orderSettingsRes.ok) {
        const data = await orderSettingsRes.json();
        setPrinterNotes(data.settings?.printer_notes || []);
      }

      if (metafieldsRes.ok) {
        const data = await metafieldsRes.json();
        setMetafieldConfigs(data.metafields || []);
      }
    } catch (err) {
      console.error('Error fetching settings:', err);
    }
  }, [currentShop]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const getProgress = useCallback(
    (orderId: string): OrderProgress => {
      const enc = encodeFirestoreId(orderId);
      return (
        progressByOrder[enc] ??
        progressByOrder[orderId] ?? { checkedCount: 0, totalCount: 0 }
      );
    },
    [progressByOrder],
  );

  const orderMode = useCallback(
    (order: ShopifyOrder): FilterMode => {
      const p = getProgress(order.id);
      if (p.totalCount === 0) return 'toValidate';
      if (p.checkedCount >= p.totalCount) return 'ready';
      if (p.checkedCount === 0) return 'toValidate';
      return 'production';
    },
    [getProgress],
  );

  const counts = useMemo(() => {
    const c = { all: 0, production: 0, toValidate: 0, ready: 0 };
    pendingOrders.forEach((o) => {
      c.all++;
      c[orderMode(o)]++;
    });
    return c;
  }, [pendingOrders, orderMode]);

  const filteredOrders = useMemo(() => {
    const s = search.trim().toLowerCase();
    return pendingOrders.filter((o) => {
      if (filter !== 'all' && orderMode(o) !== filter) return false;
      if (s.length > 0) {
        const name = o.name?.toLowerCase() || '';
        const num = o.orderNumber?.toLowerCase() || '';
        if (!name.includes(s) && !num.includes(s)) return false;
      }
      return true;
    });
  }, [pendingOrders, filter, search, orderMode]);

  const shopName = currentShop?.name || 'Runes de Chêne';

  if (isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingWrap}>
          <Loader />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div className={styles.eyebrow}>Atelier · {shopName}</div>
        <h1 className={styles.title}>
          Commandes <em>boutique</em>
        </h1>
        <div className={styles.sub}>
          {counts.all} commande{counts.all > 1 ? 's' : ''} en cours,{' '}
          {counts.toValidate} en attente de production.
        </div>
      </div>

      {printerNotes.length > 0 && (
        <div className={styles.printerNotes}>
          <IconAlertTriangle size={14} />
          <span className={styles.printerNotesLabel}>Penser à :</span>
          {printerNotes.map((note, i) => (
            <span key={i} className={styles.printerNoteChip}>
              {note}
            </span>
          ))}
        </div>
      )}

      <div className={styles.filterBar}>
        <FilterChip
          active={filter === 'all'}
          count={counts.all}
          onClick={() => setFilter('all')}
        >
          Toutes
        </FilterChip>
        <FilterChip
          active={filter === 'production'}
          count={counts.production}
          onClick={() => setFilter('production')}
        >
          En production
        </FilterChip>
        <FilterChip
          active={filter === 'toValidate'}
          count={counts.toValidate}
          onClick={() => setFilter('toValidate')}
        >
          À valider
        </FilterChip>
        <FilterChip
          active={filter === 'ready'}
          count={counts.ready}
          onClick={() => setFilter('ready')}
        >
          Prêtes
        </FilterChip>
        <div className={styles.spacer} />
        <button
          type="button"
          className={styles.sortBtn}
          onClick={toggleOrder}
          title={isReversed ? "Plus récentes d'abord" : "Plus anciennes d'abord"}
        >
          <IconArrowsSort
            size={14}
            style={{
              transform: isReversed ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s ease',
            }}
          />
          {isReversed ? 'Anciennes' : 'Récentes'}
        </button>
        <input
          type="text"
          className={styles.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un N° ou un client…"
        />
      </div>

      {filteredOrders.length === 0 ? (
        <div className={styles.emptyState}>
          Aucune commande{' '}
          {filter === 'all'
            ? ''
            : filter === 'production'
              ? 'en production'
              : filter === 'toValidate'
                ? 'à valider'
                : 'prête'}
          .
        </div>
      ) : (
        <div className={styles.grid}>
          {filteredOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              progress={getProgress(order.id)}
              metafieldConfigs={metafieldConfigs}
              onOpen={() => onSelectOrder(order.id)}
            />
          ))}
        </div>
      )}

      <OrderDrawer order={selectedOrder} opened={isDrawerOpen} onClose={onCloseDrawer} />
    </div>
  );
}
