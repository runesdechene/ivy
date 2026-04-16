import clsx from 'clsx';
import styles from './CostDisplay.module.scss';

export interface CostDisplayProps {
  qty: number;
  /** Unit cost in euros. If null/undefined, displays a dash. */
  unitCost: number | null | undefined;
  className?: string;
}

function formatEuro(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} €`;
}

export function CostDisplay({ qty, unitCost, className }: CostDisplayProps) {
  const hasCost = unitCost !== null && unitCost !== undefined;
  const totalCost = hasCost ? qty * (unitCost as number) : null;

  return (
    <div className={clsx(styles.cost, className)}>
      <div className={styles.qtyUnit}>
        <span className={styles.qty}>×{qty}</span>
        {hasCost ? (
          <span className={styles.unit}>@ {formatEuro(unitCost as number)}</span>
        ) : (
          <span className={styles.unit}>—</span>
        )}
      </div>
      <div className={styles.total}>
        {totalCost !== null ? formatEuro(totalCost) : '—'}
      </div>
      <div className={styles.label}>Coût</div>
    </div>
  );
}
