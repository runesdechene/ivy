import { useEffect, useState } from 'react';
import { supabase } from '@/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface UseLastSyncResult {
  lastSync: Date | null;
  lastSyncLabel: string | null;
  loading: boolean;
  refetch: () => void;
}

export function useLastSync(shopId: string | null | undefined): UseLastSyncResult {
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!shopId) {
      setLastSync(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    supabase
      .from('syncs')
      .select('completed_at')
      .eq('shop_id', shopId)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setLastSync(data?.completed_at ? new Date(data.completed_at) : null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shopId, tick]);

  // Re-render every 30s so the label stays fresh ("il y a 3 min" → "il y a 4 min")
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  return {
    lastSync,
    lastSyncLabel: lastSync
      ? formatDistanceToNow(lastSync, { locale: fr, addSuffix: true })
      : null,
    loading,
    refetch: () => setTick((t) => t + 1),
  };
}
