'use client';

import { useMemo } from 'react';
import clsx from 'clsx';
import { ActionIcon, Menu, Tooltip } from '@mantine/core';
import { IconDots, IconTrash } from '@tabler/icons-react';
import type { ContainerInstance } from '@/hooks/useContainers';
import { useDeleteContainer } from '@/hooks/useContainers';
import styles from './ContainerCard.module.scss';

const UNIT = 140;

const COLOR_FALLBACKS: Record<string, string> = {
  // Mocha / Chocolat
  Mocha: '#6f4a36',
  Chocolat: '#6f4a36',
  // Black / Noir
  Black: '#2a2a2a',
  Noir: '#2a2a2a',
  // White / Blanc
  White: '#f4f1ea',
  Blanc: '#f4f1ea',
  // Cream / Crème
  Cream: '#efe6d4',
  'Crème': '#efe6d4',
  Creme: '#efe6d4',
  // Sand / Sable
  Sand: '#d8c8a8',
  Sable: '#d8c8a8',
  // French Navy / Bleu Marine
  'French Navy': '#1f2c4d',
  'Bleu Marine': '#1f2c4d',
  Navy: '#1f2c4d',
  // Rust / Rouille
  Rust: '#a85a3a',
  Rouille: '#a85a3a',
  // Moss / Mousse
  Moss: '#7a8a4a',
  Mousse: '#7a8a4a',
  // Stone / Pierre
  Stone: '#a59f95',
  Pierre: '#a59f95',
  // Burgundy / Bordeaux
  Burgundy: '#5e2630',
  Bordeaux: '#5e2630',
  // Khaki
  Khaki: '#7c7a4f',
  Kaki: '#7c7a4f',
};

function colorToCss(color: string | null | undefined): string {
  if (!color) return '#cdcdcd';
  if (COLOR_FALLBACKS[color]) return COLOR_FALLBACKS[color];
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
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
    return variants.map((v) => ({
      key: v.id,
      title: v.title,
      qty: v.qty,
      color: colorToCss(v.color),
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

  return (
    <div
      className={styles.card}
      style={{ width: w + 24 }}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
    >
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
                  minWidth: 6,
                }}
              />
            </Tooltip>
          ))}
        </div>

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
