import clsx from 'clsx';
import styles from './StatusBadge.module.scss';

export type StatusBadgeVariant = 'moss' | 'clay' | 'sand' | 'slate' | 'plum' | 'rust';

export interface StatusBadgeProps {
  variant: StatusBadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function StatusBadge({ variant, children, className }: StatusBadgeProps) {
  return (
    <span className={clsx(styles.badge, styles[`badge_${variant}`], className)}>
      {children}
    </span>
  );
}
