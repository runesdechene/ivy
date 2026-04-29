'use client';

import { useMemo } from 'react';
import clsx from 'clsx';
import { ActionIcon, Menu, Tooltip } from '@mantine/core';
import { IconDots, IconTrash } from '@tabler/icons-react';
import type { ContainerInstance } from '@/hooks/useContainers';
import { useDeleteContainer } from '@/hooks/useContainers';
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
}

export function ContainerCard({ instance, onAssign }: Props) {
  const { type, fill, variants, products } = instance;
  const deleteMut = useDeleteContainer();

  const cols = Math.max(1, type.columns ?? 1);
  const colCapacity = type.max_capacity / cols;

  // Distribution greedy : pour chaque variante (qty desc) on l'assigne à la colonne
  // la moins remplie. Permet de répartir les variantes sur N colonnes.
  const columnsData = useMemo(() => {
    const buckets: { items: typeof variants; total: number }[] = Array.from(
      { length: cols },
      () => ({ items: [], total: 0 }),
    );
    if (variants.length === 0) return buckets;
    const sorted = [...variants].sort((a, b) => b.qty - a.qty);
    for (const v of sorted) {
      let target = buckets[0];
      for (const b of buckets) {
        if (b.total < target.total) target = b;
      }
      target.items.push(v);
      target.total += v.qty;
    }
    // Trier les variantes de chaque colonne par couleur (groupage visuel)
    for (const b of buckets) {
      b.items.sort((a, c) => (a.color || '').localeCompare(c.color || ''));
    }
    return buckets;
  }, [variants, cols]);

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
              <div className={styles.columnFill} style={{ height: `${colPct}%` }}>
                {bucket.items.map((v) => (
                  <Tooltip key={v.id} label={`${v.title} — ${v.qty}`} withArrow>
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
