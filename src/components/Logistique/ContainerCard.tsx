'use client';

import { useMemo } from 'react';
import clsx from 'clsx';
import { ActionIcon, Menu, Tooltip } from '@mantine/core';
import { IconDots, IconPencil, IconPackage, IconRefresh, IconTrash } from '@tabler/icons-react';
import type { ContainerInstance } from '@/hooks/useContainers';
import { useDeleteContainer, useRenameContainer } from '@/hooks/useContainers';
import { compareSizes } from '@/utils/size-helpers';
import styles from './ContainerCard.module.scss';

const UNIT = 260;

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
  onRefill: () => void;
  sortMode?: 'color' | 'size';
}

type Variant = ContainerInstance['variants'][number];

/**
 * Distribue les variantes en N colonnes en respectant l'ordre primaire :
 * - mode 'size' : XS → 5XL, top-gauche → bottom-droite
 * - mode 'color' : ordre alphabétique
 * On avance à la colonne suivante dès qu'on a atteint ~ totalQty / cols pour
 * équilibrer approximativement les hauteurs sans casser l'ordre.
 */
type Section = { key: string; items: Variant[]; total: number };
type Column = { sections: Section[]; total: number; sortKey: string };

function distributeOrdered(
  variants: Variant[],
  cols: number,
  mode: 'color' | 'size',
): Column[] {
  const buckets: Column[] = Array.from({ length: cols }, () => ({
    sections: [],
    total: 0,
    sortKey: '',
  }));
  if (variants.length === 0) return buckets;

  const groupKey = (v: Variant) => (mode === 'color' ? v.color || '_' : v.size || '_');
  const compareKeys = (a: string, b: string) =>
    mode === 'size' ? compareSizes(a, b) : a.localeCompare(b);

  const groups = new Map<string, Variant[]>();
  for (const v of variants) {
    const k = groupKey(v);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(v);
  }

  // Tri secondaire dans chaque groupe (couleur dans une section taille, ou inverse)
  for (const items of groups.values()) {
    if (mode === 'color') items.sort((a, b) => compareSizes(a.size, b.size));
    else items.sort((a, b) => (a.color || '').localeCompare(b.color || ''));
  }

  // Sections triées par clé primaire — XS → 5XL ou alpha
  const sortedGroupEntries = Array.from(groups.entries()).sort((a, b) =>
    compareKeys(a[0], b[0]),
  );

  const totalQty = sortedGroupEntries.reduce(
    (s, [, items]) => s + items.reduce((ss, v) => ss + v.qty, 0),
    0,
  );
  const targetPerCol = totalQty > 0 ? totalQty / cols : 0;

  let colIdx = 0;
  let colTotal = 0;
  for (const [key, items] of sortedGroupEntries) {
    const sectionTotal = items.reduce((s, v) => s + v.qty, 0);
    if (colIdx < cols - 1 && colTotal > 0 && colTotal >= targetPerCol) {
      colIdx += 1;
      colTotal = 0;
    }
    buckets[colIdx].sections.push({ key, items, total: sectionTotal });
    buckets[colIdx].total += sectionTotal;
    colTotal += sectionTotal;
  }

  buckets.forEach((b) => {
    b.sortKey = b.sections[0]?.key ?? '';
  });

  return buckets;
}

export function ContainerCard({ instance, onAssign, onRefill, sortMode = 'color' }: Props) {
  const { type, fill, variants, products } = instance;
  const deleteMut = useDeleteContainer();
  const renameMut = useRenameContainer();

  const cols = Math.max(1, type.columns ?? 1);
  const colCapacity = type.max_capacity / cols;

  const columnsData = useMemo(
    () => distributeOrdered(variants, cols, sortMode),
    [variants, cols, sortMode],
  );

  const w = UNIT * type.ratio_w;
  const h = UNIT * type.ratio_h;
  const weather = weatherEmoji(fill.pct);

  const displayName = instance.name?.trim() || type.name;

  const handleDelete = async () => {
    if (!confirm(`Retirer cette caisse "${displayName}" ?`)) return;
    await deleteMut.mutateAsync(instance.id);
  };

  const handleRename = async () => {
    const next = window.prompt('Nom de la caisse (vide = nom du type) :', instance.name ?? '');
    if (next === null) return;
    await renameMut.mutateAsync({ id: instance.id, name: next.trim() || null });
  };

  return (
    <div className={styles.card} style={{ width: w + 24 }}>
      <div className={styles.menu}>
        <Menu position="bottom-end" withArrow>
          <Menu.Target>
            <ActionIcon variant="subtle" size="md" color="gray" aria-label="Options">
              <IconDots size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconRefresh size={14} />} onClick={onRefill}>
              Refournir
            </Menu.Item>
            <Menu.Item leftSection={<IconPackage size={14} />} onClick={onAssign}>
              Affecter des produits
            </Menu.Item>
            <Menu.Item leftSection={<IconPencil size={14} />} onClick={handleRename}>
              Renommer
            </Menu.Item>
            <Menu.Divider />
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

      <div className={styles.stats} style={{ width: w }}>
        <Tooltip label={weather.label} withArrow>
          <span className={styles.weatherBadge}>{weather.emoji}</span>
        </Tooltip>
        <span className={styles.statBadge}>
          {fill.pct}% · {fill.units}/{type.max_capacity}
          {fill.weight_g != null && ` · ${(fill.weight_g / 1000).toFixed(1)} kg`}
        </span>
      </div>

      <div
        className={styles.box}
        style={{ width: w, height: h, gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >

        {columnsData.map((bucket, idx) => {
          const colPct = colCapacity > 0 ? Math.min(100, (bucket.total / colCapacity) * 100) : 0;
          return (
            <div key={idx} className={styles.column}>
              <div className={styles.columnFill} style={{ height: `${colPct}%` }}>
                {bucket.sections.map((sec) => (
                  <div
                    key={sec.key}
                    className={styles.section}
                    style={{ flexGrow: sec.total }}
                  >
                    {sec.key !== '_' && (
                      <span className={styles.sectionLabel}>
                        <span className={styles.sectionCount}>{sec.total}</span>{' '}
                        {sec.key}
                      </span>
                    )}
                    <div className={styles.sectionStripes}>
                      {sec.items.flatMap((v) => {
                        const tip = `${v.color || ''} ${v.size || ''} — ${v.qty}`.trim();
                        const bg = colorToCss(v.color_hex);
                        return Array.from({ length: v.qty }).map((_, i) => (
                          <Tooltip key={`${v.id}-${i}`} label={tip} withArrow>
                            <div
                              className={styles.block}
                              style={{ flexGrow: 1, background: bg }}
                            />
                          </Tooltip>
                        ));
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

      </div>

      <div className={styles.footer}>
        <span className={styles.title}>{displayName}</span>
        {instance.name && (
          <span className={styles.subtitle}>{type.name}</span>
        )}
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
