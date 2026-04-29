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

  const blocks = useMemo(() => {
    if (variants.length === 0 || fill.units === 0) return [];
    // Trier par couleur (groupé) pour des stripes plus lisibles
    const sorted = [...variants].sort((a, b) =>
      (a.color || '').localeCompare(b.color || ''),
    );
    return sorted.map((v) => ({
      key: v.id,
      title: v.title,
      qty: v.qty,
      color: colorToCss(v.color_hex),
      flex: v.qty,
    }));
  }, [variants, fill.units]);

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

  const cols = Math.max(1, type.columns ?? 1);

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

      <div className={styles.box} style={{ width: w, height: h }}>
        <Tooltip label={weather.label} withArrow>
          <span className={styles.weatherBadge}>{weather.emoji}</span>
        </Tooltip>

        <span className={styles.statBadge}>
          {fill.pct}%
          {fill.weight_g != null && ` · ${(fill.weight_g / 1000).toFixed(1)} kg`}
        </span>

        <div className={styles.fill} style={{ height: `${Math.min(100, fill.pct)}%` }}>
          {blocks.map((b) => (
            <Tooltip key={b.key} label={`${b.title} — ${b.qty}`} withArrow>
              <div
                className={styles.block}
                style={{
                  flexGrow: b.flex,
                  background: b.color,
                  minHeight: 4,
                }}
              />
            </Tooltip>
          ))}
        </div>

        {cols > 1 && (
          <div
            className={styles.compartments}
            style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
          >
            {Array.from({ length: cols }).map((_, i) => (
              <div key={i} className={styles.divider} />
            ))}
          </div>
        )}

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
