import clsx from 'clsx';
import styles from './SkuChip.module.scss';

export interface SkuChipProps {
  children: React.ReactNode;
  className?: string;
}

export function SkuChip({ children, className }: SkuChipProps) {
  return <span className={clsx(styles.chip, className)}>{children}</span>;
}
