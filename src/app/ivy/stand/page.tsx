'use client';

import { useState, useEffect } from 'react';
import { Loader, SimpleGrid } from '@mantine/core';
import {
  IconArrowDown,
  IconArrowUp,
  IconCalendar,
  IconPackage,
  IconMapPin,
} from '@tabler/icons-react';
import { createClient } from '@supabase/supabase-js';
import { useShop } from '@/context/ShopContext';
import { useLocation } from '@/context/LocationContext';
import styles from './stand-dashboard.module.scss';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface DashboardStats {
  todayItemsOut: number;
  todayItemsReturn: number;
  weekItemsOut: number;
  monthItemsOut: number;
}

export default function FestivalDashboardPage() {
  const { currentShop } = useShop();
  const { currentLocation } = useLocation();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentShop?.id) return;

    const loadStats = async () => {
      setLoading(true);

      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString().split('T')[0];
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

      // Resolve location ID (could be Shopify numeric ID, need UUID)
      let resolvedLocationId: string | null = currentLocation?.id || null;
      if (resolvedLocationId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedLocationId)) {
        const { data: loc } = await supabase
          .from('locations')
          .select('id')
          .eq('shopify_id', resolvedLocationId)
          .single();
        resolvedLocationId = loc?.id || null;
      }

      const fetchMovements = async (from: string) => {
        let query = supabase
          .from('stock_movements')
          .select('quantity')
          .eq('shop_id', currentShop!.id)
          .gte('moved_on', from);

        if (resolvedLocationId) {
          query = query.eq('location_id', resolvedLocationId);
        }

        const { data } = await query;
        const movements = data || [];
        const itemsOut = movements.filter(m => m.quantity < 0).reduce((sum, m) => sum + Math.abs(m.quantity), 0);
        const itemsReturn = movements.filter(m => m.quantity > 0).reduce((sum, m) => sum + m.quantity, 0);
        return { itemsOut, itemsReturn };
      };

      const todayData = await fetchMovements(today);
      const weekData = await fetchMovements(weekAgo);
      const monthData = await fetchMovements(monthStart);

      setStats({
        todayItemsOut: todayData.itemsOut,
        todayItemsReturn: todayData.itemsReturn,
        weekItemsOut: weekData.itemsOut,
        monthItemsOut: monthData.itemsOut,
      });

      setLoading(false);
    };

    loadStats();
  }, [currentShop?.id, currentLocation?.id]);

  const shopName = currentShop?.name || 'Runes de Chêne';

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingWrap}>
          <Loader color="moss" />
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className={styles.container}>
        <div className={styles.errorWrap}>
          Impossible de charger les statistiques.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.pageHead}>
        <div className={styles.pageHeadLeft}>
          <div className={styles.eyebrow}>Festivals · {shopName}</div>
          <h1 className={styles.title}>
            Tableau <em>de bord</em>
          </h1>
          <div className={styles.sub}>
            <span>Récapitulatif des mouvements stock</span>
            {currentLocation && (
              <>
                <span className={styles.subSep}>·</span>
                <span className={styles.locationChip}>
                  <IconMapPin size={11} />
                  {currentLocation.name}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md" className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <div className={styles.metricBody}>
            <div className={styles.metricLabel}>Sorties aujourd&apos;hui</div>
            <div className={styles.metricValue}>
              {stats.todayItemsOut.toLocaleString('fr-FR')}
            </div>
            <span className={styles.metricUnit}>
              article{stats.todayItemsOut > 1 ? 's' : ''}
            </span>
          </div>
          <div className={`${styles.metricIcon} ${styles.metricIcon_clay}`}>
            <IconArrowDown size={20} />
          </div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricBody}>
            <div className={styles.metricLabel}>Retours aujourd&apos;hui</div>
            <div className={`${styles.metricValue} ${styles.metricValueNeutral}`}>
              {stats.todayItemsReturn.toLocaleString('fr-FR')}
            </div>
            <span className={styles.metricUnit}>
              article{stats.todayItemsReturn > 1 ? 's' : ''}
            </span>
          </div>
          <div className={`${styles.metricIcon} ${styles.metricIcon_slate}`}>
            <IconArrowUp size={20} />
          </div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricBody}>
            <div className={styles.metricLabel}>Cette semaine</div>
            <div className={styles.metricValue}>
              {stats.weekItemsOut.toLocaleString('fr-FR')}
            </div>
            <span className={styles.metricUnit}>
              article{stats.weekItemsOut > 1 ? 's' : ''} sorti{stats.weekItemsOut > 1 ? 's' : ''}
            </span>
          </div>
          <div className={`${styles.metricIcon} ${styles.metricIcon_plum}`}>
            <IconCalendar size={20} />
          </div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricBody}>
            <div className={styles.metricLabel}>Ce mois</div>
            <div className={styles.metricValue}>
              {stats.monthItemsOut.toLocaleString('fr-FR')}
            </div>
            <span className={styles.metricUnit}>
              article{stats.monthItemsOut > 1 ? 's' : ''} sorti{stats.monthItemsOut > 1 ? 's' : ''}
            </span>
          </div>
          <div className={`${styles.metricIcon} ${styles.metricIcon_moss}`}>
            <IconPackage size={20} />
          </div>
        </div>
      </SimpleGrid>
    </div>
  );
}
