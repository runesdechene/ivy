'use client';

import { useMemo } from 'react';
import clsx from 'clsx';
import { ActionIcon, Menu, Tooltip } from '@mantine/core';
import { IconDots, IconTrash } from '@tabler/icons-react';
import type { ContainerInstance } from '@/hooks/useContainers';
import { useDeleteContainer } from '@/hooks/useContainers';
import { compareSizes } from '@/utils/size-helpers';
import styles from './ContainerCard.module.scss';

const UNIT = 140;

function colorToCss(hex: string | null | undefined): string {
  if (hex && /^#[0-9a-f]{3,8}$/i.test(hex)) return hex;
  return '#cdcdcd';
}

function weatherEmoji(pct: number): { emoji: string; label: string } {
  if (pct >= 70) return { emoji: '☀️', label: 'Bien rempli' };
  if (pct >= 40) return { emoji: '☁️', label: 'À surveiller' };
  return { emoji: '⛈️', label: 'À recommander' };
}

interface Props {
  instance: ContainerInstance;
  onAssign: () => void;
  sortMode?: 'color' | 'size';
}

type Variant = ContainerInstance['variants'][number];

/**
 * Distribue les variantes en N colonnes en gardant les groupes (couleur ou taille)
 * contigus : on remplit la colonne 1 jusqu'à atteindre la capacité, puis colonne 2, etc.
 * Les groupes ne sont jamais coupés (sauf si un seul groupe dépasse la capacité d'une colonne).
 */
function distributeSequential(
  variants: Variant[],
  cols: number,
  capPerCol: number,
  mode: 'color' | 'size',
): { items: Variant[]; total: number; label: string }[] {
  const buckets = Array.from({ length: cols }, () => ({ items: [] as Variant[], total: 0, label: '' }));
  if (variants.length === 0) return buckets;

  const groupKey = (v: Variant) =>
    mode === 'color' ? v.color || '_' : v.size || '_';

  // Group
  const groups = new Map<string, Variant[]>();
  for (const v of variants) {
    const k = groupKey(v);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(v);
  }

  // Sort group keys
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
    if (mode === 'size') return compareSizes(a, b);
    return a.localeCompare(b);
  });

  // Within each group, secondary sort
  for (const k of sortedKeys) {
    const items = groups.get(k)!;
    if (mode === 'color') {
      items.sort((a, b) => compareSizes(a.size, b.size));
    } else {
      items.sort((a, b) => (a.color || '').localeCompare(b.color || ''));
    }
  }

  // Sequential fill : on remplit colonne par colonne, en gardant les groupes contigus
  let colIdx = 0;
  for (const key of sortedKeys) {
    const items = groups.get(key)!;
    const groupTotal = items.reduce((s, v) => s + v.qty, 0);

    // Si la colonne courante est déjà ≥ capacité ET il en reste, passer à la suivante
    if (
      buckets[colIdx].total >= capPerCol &&
      colIdx < cols - 1
    ) {
      colIdx++;
    }
    // Si le groupe ferait largement déborder ET on est en milieu de colonne
    // (au moins un peu rempli) ET il reste de la place dans une colonne plus loin,
    // on saute aussi
    else if (
      buckets[colIdx].total > 0 &&
      buckets[colIdx].total + groupTotal > capPerCol * 1.5 &&
      colIdx < cols - 1
    ) {
      colIdx++;
    }

    for (const v of items) {
      buckets[colIdx].items.push(v);
      buckets[colIdx].total += v.qty;
    }
    if (!buckets[colIdx].label) {
      buckets[colIdx].label = key === '_' ? '' : key;
    } else if (key !== '_') {
      buckets[colIdx].label += ` · ${key}`;
    }
  }

  return buckets;
}

export function ContainerCard({ instance, onAssign, sortMode = 'color' }: Props) {
  const { type, fill, variants, products } = instance;
  const deleteMut = useDeleteContainer();

  const cols = Math.max(1, type.columns ?? 1);
  const colCapacity = type.max_capacity / cols;

  const columnsData = useMemo(
    () => distributeSequential(variants, cols, colCapacity, sortMode),
    [variants, cols, colCapacity, sortMode],
  );

  const w = UNIT * type.ratio_w;
  const h = UNIT * type.ratio_h;
  const weather = weatherEmoji(fill.pct);

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-noprop="true"]')) return;
    onAssign();
  };

  const handleDelete = async () => {
    if (!confirm(`Retirer cette caisse "${type.name}" ?`)) return;
    await deleteMut.mutateAsync(instance.id);
  };

  return (
    <div
      className={styles.card}
      style={{ width: w + 24 }}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
    >
      <div className={styles.thumbs}>
        {products.length === 0 ? (
          <span className={styles.thumbPlaceholder}>—</span>
        ) : (
          products.map((p) => {
            const src = p.image_url || p.illustration_url;
            return (
              <Tooltip key={p.id} label={p.title} withArrow>
                {src ? (
                  <span
                    className={styles.thumb}
                    style={{ backgroundImage: `url("${src}")` }}
                    aria-label={p.title}
                  />
                ) : (
                  <span className={styles.thumbPlaceholder} aria-label={p.title}>
                    {p.title.slice(0, 1)}
                  </span>
                )}
              </Tooltip>
            );
          })
        )}
      </div>

      <div
        className={styles.box}
        style={{ width: w, height: h, gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >
        <Tooltip label={weather.label} withArrow>
          <span className={styles.weatherBadge}>{weather.emoji}</span>
        </Tooltip>

        <span className={styles.statBadge}>
          {fill.pct}%
          {fill.weight_g != null && ` · ${(fill.weight_g / 1000).toFixed(1)} kg`}
        </span>

        {columnsData.map((bucket, idx) => {
          const colPct = colCapacity > 0 ? Math.min(100, (bucket.total / colCapacity) * 100) : 0;
          return (
            <div key={idx} className={styles.column}>
              {bucket.label && colPct < 95 && (
                <span className={styles.columnLabel}>{bucket.label}</span>
              )}
              <div className={styles.columnFill} style={{ height: `${colPct}%` }}>
                {bucket.items.map((v) => (
                  <Tooltip
                    key={v.id}
                    label={`${v.color || ''} ${v.size || ''} — ${v.qty}`.trim()}
                    withArrow
                  >
                    <div
                      className={styles.block}
                      style={{
                        flexGrow: v.qty,
                        background: colorToCss(v.color_hex),
                        minHeight: 3,
                      }}
                    />
                  </Tooltip>
                ))}
              </div>
            </div>
          );
        })}

        <div data-noprop="true" className={styles.menu}>
          <Menu position="bottom-end" withArrow>
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                size="sm"
                color="gray"
                onClick={(e) => e.stopPropagation()}
                aria-label="Options"
              >
                <IconDots size={14} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconTrash size={14} />}
                color="red"
                onClick={handleDelete}
              >
                Retirer la caisse
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>

      <div className={styles.footer}>
        <span className={styles.title}>{type.name}</span>
        {products.length > 0 ? (
          <span className={styles.products}>
            {products.map((p) => p.title).join(' · ')}
          </span>
        ) : (
          <span className={clsx(styles.products, styles.empty)}>
            Aucun produit affecté
          </span>
        )}
      </div>
    </div>
  );
}
