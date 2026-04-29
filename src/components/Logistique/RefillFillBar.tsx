'use client';

import clsx from 'clsx';
import styles from './RefillFillBar.module.scss';

interface Props {
  current: number;
  added: number;
  capacity: number;
}

export function RefillFillBar({ current, added, capacity }: Props) {
  const safeCap = Math.max(1, capacity);
  const total = current + added;
  const overflow = Math.max(0, total - safeCap);
  const overflowPct = overflow > 0 ? (overflow / safeCap) * 100 : 0;
  const currentPct = Math.min(100, (current / safeCap) * 100);
  const addedPct = Math.min(100 - currentPct, (added / safeCap) * 100);

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <div
          className={clsx(styles.zone, styles.current)}
          style={{ width: `${currentPct}%` }}
          aria-label={`Actuel ${current}`}
        />
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
          Actuel <strong>{current}</strong> → Après <strong>{total}</strong> / {capacity}
        </span>
        {overflow > 0 && <span className={styles.overflowLabel}>+{overflow} hors capacité</span>}
      </div>
    </div>
  );
}
