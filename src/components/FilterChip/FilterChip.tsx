import clsx from 'clsx';
import styles from './FilterChip.module.scss';

export interface FilterChipProps {
  active?: boolean;
  count?: number;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

export function FilterChip({ active, count, onClick, children, className }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(styles.chip, active && styles.active, className)}
    >
      <span>{children}</span>
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </button>
  );
}
