import clsx from 'clsx';
import styles from './IvyMark.module.scss';

export interface IvyMarkProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  theme?: 'light' | 'dark';
  withParent?: boolean;
  className?: string;
}

export function IvyMark({
  size = 'md',
  theme = 'light',
  withParent = false,
  className,
}: IvyMarkProps) {
  return (
    <span
      className={clsx(
        styles.mark,
        styles[`mark_${size}`],
        styles[`mark_${theme}`],
        className,
      )}
    >
      <span className={styles.word}>Ivy</span>
      <span className={styles.dot} aria-hidden="true" />
      {withParent && (
        <span className={styles.parent}>par Runes de Chêne</span>
      )}
    </span>
  );
}
