'use client';

import { Loader, Pagination } from '@mantine/core';
import { useArchivedOrdersPagePresenter } from './ArchivedOrdersPage.presenter';
import { clsx } from 'clsx';
import { OrderDrawer } from '@/components/OrderDrawer/OrderDrawer';
import { StatusBadge } from '@/components/StatusBadge';
import { TagPill } from '@/components/TagPill';
import { MetaChip } from '@/components/MetaChip';
import { SkuChip } from '@/components/SkuChip';
import { ProductThumbnail } from '@/components/ProductThumbnail';
import { CostDisplay } from '@/components/CostDisplay';
import styles from './DetailedOrdersPage.module.scss';
import { transformColor, getColorHex, loadColorMappingsFromSupabase } from '@/utils/color-transformer';
import { getColorFromVariant } from '@/utils/variant-helpers';
import { formatDate } from '@/utils/date-helpers';
import { EXCLUDED_TAGS } from '@/config/excluded-tags';
import {
  IconPrinter,
  IconDots,
  IconArrowsSort,
  IconCheck,
} from '@tabler/icons-react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ShopifyOrder } from '@/types/shopify';
import { useShop } from '@/context/ShopContext';
import { generatePrintContent } from '@/utils/print-content';
import { printInIframe } from '@/utils/print-helpers';

interface MetafieldConfig {
  namespace: string;
  key: string;
  display_name: string;
}

const EXCLUDED_TAGS_LC = (EXCLUDED_TAGS as readonly string[]).map((t) => t.toLowerCase());

function formatEuro(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} €`;
}

// ---------------------------------------------------------------------------
// ItemRow (read-only — no checkboxes, items shown as completed with moss check)
// ---------------------------------------------------------------------------

interface ItemRowProps {
  item: NonNullable<ShopifyOrder['lineItems']>[number];
  metafieldConfigs: MetafieldConfig[];
}

function ItemRow({ item, metafieldConfigs }: ItemRowProps) {
  const color = getColorFromVariant(item);
  const variantLabel = item.variantTitle
    ? item.variantTitle
        .split(' / ')
        .map((v) => transformColor(v))
        .join(' / ')
    : '';
  const colorHex = color ? getColorHex(color) : '#cccccc';

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
      className={clsx(styles.item, styles.itemArchived, { [styles.cancelled]: item.isCancelled })}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.itemCheckArchived} aria-hidden="true">
        {Array.from({ length: item.quantity }).map((_, qi) => (
          <span key={qi} className={styles.checkDone}>
            <IconCheck size={11} stroke={2.5} />
          </span>
        ))}
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
// ArchivedOrderCard
// ---------------------------------------------------------------------------

interface ArchivedOrderCardProps {
  order: ShopifyOrder;
  metafieldConfigs: MetafieldConfig[];
  onOpen: () => void;
}

function ArchivedOrderCard({ order, metafieldConfigs, onOpen }: ArchivedOrderCardProps) {
  const [kebabOpen, setKebabOpen] = useState(false);
  const kebabRef = useRef<HTMLDivElement | null>(null);
  const suppressNextCardClickRef = useRef(false);

  useEffect(() => {
    if (!kebabOpen) return;
    const onClick = (e: MouseEvent) => {
      if (kebabRef.current && !kebabRef.current.contains(e.target as Node)) {
        setKebabOpen(false);
        suppressNextCardClickRef.current = true;
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [kebabOpen]);

  const handlePrint = (e: React.MouseEvent) => {
    e.stopPropagation();
    setKebabOpen(false);
    const content = generatePrintContent({ order });
    printInIframe({ content });
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
  const isRefunded = financial === 'refunded' || financial === 'partially_refunded';

  return (
    <div
      className={styles.card}
      onClick={() => {
        if (suppressNextCardClickRef.current) {
          suppressNextCardClickRef.current = false;
          return;
        }
        onOpen();
      }}
      role="button"
      tabIndex={0}
    >
      <div className={styles.cardHead}>
        <div className={styles.cardHeadTop}>
          <div className={styles.orderNum}>{order.name}</div>
          {visibleTags.map((tag) => (
            <TagPill key={tag}>{tag}</TagPill>
          ))}
          <div className={styles.cardHeadRight}>
            {isRefunded ? (
              <StatusBadge variant="rust">Remboursée</StatusBadge>
            ) : (
              <StatusBadge variant="slate">Archivée</StatusBadge>
            )}
          </div>
        </div>
        <div className={styles.cardHeadBottom}>
          <span className={styles.date}>{formatDate(order.createdAt)}</span>
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
          items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              metafieldConfigs={metafieldConfigs}
            />
          ))
        )}
      </div>

      {order.note && <div className={styles.noteAlert}>{order.note}</div>}

      <div className={styles.cardFoot}>
        <div className={styles.footStaticLabel}>100% expédiée</div>
        <div className={styles.footRight} ref={kebabRef}>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            Détails
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
                onClick={handlePrint}
              >
                <IconPrinter size={14} /> Imprimer le feuillet
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

export function ArchivedOrdersPage() {
  const {
    archivedOrders,
    totalOrders,
    currentPage,
    totalPages,
    handlePageChange,
    selectedOrder,
    isDrawerOpen,
    onSelectOrder,
    onCloseDrawer,
    isLoading,
    isReversed,
    toggleOrder,
  } = useArchivedOrdersPagePresenter();

  const { currentShop } = useShop();
  const [metafieldConfigs, setMetafieldConfigs] = useState<MetafieldConfig[]>([]);
  const [search, setSearch] = useState('');

  const fetchSettings = useCallback(async () => {
    if (!currentShop) return;
    try {
      await loadColorMappingsFromSupabase(currentShop.id);
      const metafieldsRes = await fetch(`/api/settings/metafields?shopId=${currentShop.id}`);
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

  const filteredOrders = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (s.length === 0) return archivedOrders;
    return archivedOrders.filter((o) => {
      const name = o.name?.toLowerCase() || '';
      const num = o.orderNumber?.toLowerCase() || '';
      return name.includes(s) || num.includes(s);
    });
  }, [archivedOrders, search]);

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
          Archives <em>boutique</em>
        </h1>
        <div className={styles.sub}>
          {totalOrders} commande{totalOrders > 1 ? 's' : ''} archivée{totalOrders > 1 ? 's' : ''}
        </div>
      </div>

      <div className={styles.filterBar}>
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
          placeholder="Rechercher un numéro de commande…"
        />
      </div>

      {totalPages > 1 && (
        <div className={styles.paginationWrap}>
          <Pagination
            total={totalPages}
            value={currentPage}
            onChange={handlePageChange}
            size="md"
          />
        </div>
      )}

      {filteredOrders.length === 0 ? (
        <div className={styles.emptyState}>Aucune commande archivée.</div>
      ) : (
        <div className={styles.grid}>
          {filteredOrders.map((order) => (
            <ArchivedOrderCard
              key={order.id}
              order={order}
              metafieldConfigs={metafieldConfigs}
              onOpen={() => onSelectOrder(order.id)}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className={styles.paginationWrap}>
          <Pagination
            total={totalPages}
            value={currentPage}
            onChange={handlePageChange}
            size="md"
          />
        </div>
      )}

      <OrderDrawer
        order={selectedOrder}
        opened={isDrawerOpen}
        onClose={onCloseDrawer}
      />
    </div>
  );
}
