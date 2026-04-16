import clsx from 'clsx';
import styles from './MetaChip.module.scss';

export interface MetaChipProps {
  keyName: string;
  value: string;
  className?: string;
}

export function MetaChip({ keyName, value, className }: MetaChipProps) {
  return (
    <span className={clsx(styles.chip, className)}>
      <strong className={styles.key}>{keyName} :</strong>
      <span className={styles.value}>{value}</span>
    </span>
  );
}
