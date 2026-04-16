import clsx from 'clsx';
import styles from './TagPill.module.scss';

export interface TagPillProps {
  children: React.ReactNode;
  className?: string;
}

export function TagPill({ children, className }: TagPillProps) {
  return <span className={clsx(styles.pill, className)}>{children}</span>;
}
