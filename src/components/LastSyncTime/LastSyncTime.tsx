'use client';

import { useLastSync } from '@/hooks/useLastSync';
import { useShop } from '@/context/ShopContext';
import styles from './LastSyncTime.module.scss';

interface LastSyncTimeProps {
  className?: string;
}

export function LastSyncTime({ className }: LastSyncTimeProps) {
  const { currentShop } = useShop();
  const { lastSyncLabel, loading } = useLastSync(currentShop?.id);

  if (loading || !lastSyncLabel) return null;

  return (
    <span className={`${styles.timestamp} ${className ?? ''}`}>
      {lastSyncLabel}
    </span>
  );
}
