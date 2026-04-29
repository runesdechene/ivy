'use client';

import clsx from 'clsx';
import { Tooltip } from '@mantine/core';
import { type PendingOrderBreakdown } from '@/hooks/useRefill';
import styles from './RefillFillBar.module.scss';

interface Props {
  current: number;
  pending: number;
  added: number;
  capacity: number;
  pendingBreakdown?: PendingOrderBreakdown[];
}

export function RefillFillBar({ current, pending, added, capacity, pendingBreakdown }: Props) {
  const safeCap = Math.max(1, capacity);
  const total = current + pending + added;
  const overflow = Math.max(0, total - safeCap);
  const overflowPct = overflow > 0 ? (overflow / safeCap) * 100 : 0;
  const currentPct = Math.min(100, (current / safeCap) * 100);
  const pendingPct = Math.min(Math.max(0, 100 - currentPct), (pending / safeCap) * 100);
  const addedPct = Math.min(
    Math.max(0, 100 - currentPct - pendingPct),
    (added / safeCap) * 100,
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <div
          className={clsx(styles.zone, styles.current)}
          style={{ width: `${currentPct}%` }}
          aria-label={`Actuel ${current}`}
        />
        {pending > 0 && (
          <div
            className={clsx(styles.zone, styles.pending)}
            style={{ width: `${pendingPct}%` }}
            aria-label={`En commande ${pending}`}
          />
        )}
        <div
          className={clsx(styles.zone, styles.added)}
          style={{ width: `${addedPct}%` }}
          aria-label={`Ajouté ${added}`}
        />
        {overflow > 0 && (
          <div
            className={clsx(styles.zone, styles.overflow)}
            style={{ width: `${overflowPct}%` }}
            aria-label={`Hors capacité +${overflow}`}
          />
        )}
      </div>
      <div className={styles.labels}>
        <span className={styles.label}>
          Actuel <strong>{current}</strong>
          {pending > 0 && (
            <>
              {' '}+{' '}
              <Tooltip
                label={
                  pendingBreakdown && pendingBreakdown.length > 0
                    ? pendingBreakdown
                        .map((b) => `${b.orderNumber} (${b.status}) : ${b.qty}`)
                        .join('\n')
                    : 'Aucun détail'
                }
                multiline
                withArrow
              >
                <span className={styles.pendingPill}>
                  <strong>{pending}</strong>{' '}
                  <span className={styles.pendingHint}>en commande</span>
                </span>
              </Tooltip>
            </>
          )}
          {' '}→ Après <strong>{total}</strong> / {capacity}
        </span>
        {overflow > 0 && <span className={styles.overflowLabel}>+{overflow} hors capacité</span>}
      </div>
    </div>
  );
}
