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
 * contigus, ET en équilibrant les hauteurs (greedy bin-packing au niveau des groupes).
 * Les groupes les plus gros sont placés en premier, dans la colonne la moins remplie.
 * Les colonnes sont ensuite réordonnées selon leur clé minimale (alpha ou taille) pour
 * garder un ordre de gauche à droite cohérent.
 */
type Section = { key: string; items: Variant[]; total: number };
type Column = { sections: Section[]; total: number; sortKey: string };

function distributeBalanced(
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

  const groups = new Map<string, Variant[]>();
  for (const v of variants) {
    const k = groupKey(v);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(v);
  }

  // Tri secondaire dans chaque groupe
  for (const items of groups.values()) {
    if (mode === 'color') items.sort((a, b) => compareSizes(a.size, b.size));
    else items.sort((a, b) => (a.color || '').localeCompare(b.color || ''));
  }

  // Greedy bin-packing : groupes triés par qty desc, chaque groupe va dans la
  // colonne la moins remplie → hauteurs équilibrées sans couper les groupes.
  const groupEntries = Array.from(groups.entries()).sort((a, b) => {
    const totalA = a[1].reduce((s, v) => s + v.qty, 0);
    const totalB = b[1].reduce((s, v) => s + v.qty, 0);
    return totalB - totalA;
  });

  for (const [key, items] of groupEntries) {
    let target = buckets[0];
    for (const b of buckets) {
      if (b.total < target.total) target = b;
    }
    const sectionTotal = items.reduce((s, v) => s + v.qty, 0);
    target.sections.push({ key, items, total: sectionTotal });
    target.total += sectionTotal;
  }

  const compareKeys = (a: string, b: string) =>
    mode === 'size' ? compareSizes(a, b) : a.localeCompare(b);

  // Trier les sections de chaque colonne selon l'ordre naturel
  for (const b of buckets) {
    b.sections.sort((a, c) => compareKeys(a.key, c.key));
    b.sortKey = b.sections[0]?.key ?? '';
  }

  // Réordonner les colonnes par leur clé minimale (gauche à droite cohérent),
  // colonnes vides à droite
  buckets.sort((a, b) => {
    if (a.total === 0 && b.total === 0) return 0;
    if (a.total === 0) return 1;
    if (b.total === 0) return -1;
    return compareKeys(a.sortKey, b.sortKey);
  });

  return buckets;
}

export function ContainerCard({ instance, onAssign, sortMode = 'color' }: Props) {
  const { type, fill, variants, products } = instance;
  const deleteMut = useDeleteContainer();

  const cols = Math.max(1, type.columns ?? 1);
  const colCapacity = type.max_capacity / cols;

  const columnsData = useMemo(
    () => distributeBalanced(variants, cols, sortMode),
    [variants, cols, sortMode],
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

      <div className={styles.stats} style={{ width: w }}>
        <Tooltip label={weather.label} withArrow>
          <span className={styles.weatherBadge}>{weather.emoji}</span>
        </Tooltip>
        <span className={styles.statBadge}>
          {fill.pct}%
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
                        <span className={styles.sectionCount}>{sec.items.length}</span>{' '}
                        {sec.key}
                      </span>
                    )}
                    <div className={styles.sectionStripes}>
                      {sec.items.map((v) => (
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
