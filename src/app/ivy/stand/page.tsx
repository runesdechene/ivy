'use client';

import { useState, useEffect } from 'react';
import {
  Title,
  Text,
  Card,
  Group,
  Stack,
  SimpleGrid,
  Loader,
  Center,
  RingProgress,
} from '@mantine/core';
import { IconCash, IconReceipt, IconUsers, IconTrendingUp } from '@tabler/icons-react';
import { createClient } from '@supabase/supabase-js';
import { useShop } from '@/context/ShopContext';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface DashboardStats {
  todaySalesCount: number;
  todayRevenue: number;
  todayRefundsCount: number;
  todayRefundsAmount: number;
  todayItemsSold: number;
  todayAverageCart: number;
  weekRevenue: number;
  monthRevenue: number;
}

export default function StandDashboardPage() {
  const { currentShop } = useShop();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentShop?.id) return;

    const loadStats = async () => {
      setLoading(true);

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      // Today's sales
      const { data: todaySales } = await supabase
        .from('pos_sales')
        .select('total_amount, items_count, is_refund, discount_amount')
        .eq('shop_id', currentShop.id)
        .gte('created_at', todayStart);

      // Week sales
      const { data: weekSales } = await supabase
        .from('pos_sales')
        .select('total_amount, is_refund')
        .eq('shop_id', currentShop.id)
        .eq('is_refund', false)
        .gte('created_at', weekStart);

      // Month sales
      const { data: monthSales } = await supabase
        .from('pos_sales')
        .select('total_amount, is_refund')
        .eq('shop_id', currentShop.id)
        .eq('is_refund', false)
        .gte('created_at', monthStart);

      const sales = todaySales || [];
      const actualSales = sales.filter(s => !s.is_refund);
      const refunds = sales.filter(s => s.is_refund);

      const todayRevenue = actualSales.reduce((sum, s) => sum + s.total_amount, 0);
      const todayItemsSold = actualSales.reduce((sum, s) => sum + s.items_count, 0);

      setStats({
        todaySalesCount: actualSales.length,
        todayRevenue,
        todayRefundsCount: refunds.length,
        todayRefundsAmount: refunds.reduce((sum, s) => sum + Math.abs(s.total_amount), 0),
        todayItemsSold,
        todayAverageCart: actualSales.length > 0 ? todayRevenue / actualSales.length : 0,
        weekRevenue: (weekSales || []).reduce((sum, s) => sum + s.total_amount, 0),
        monthRevenue: (monthSales || []).reduce((sum, s) => sum + s.total_amount, 0),
      });

      setLoading(false);
    };

    loadStats();
  }, [currentShop?.id]);

  const formatPrice = (price: number) => {
    return price.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  if (loading) {
    return (
      <Center h={400}>
        <Loader size="lg" />
      </Center>
    );
  }

  if (!stats) return null;

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Tableau de bord — Commandes stand</Title>
        <Text c="dimmed" size="sm">
          Vue d'ensemble des ventes effectuées en caisse
        </Text>
      </div>

      {/* Today stats */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <Card withBorder padding="lg">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="sm" c="dimmed" tt="uppercase" fw={600}>
                Ventes aujourd'hui
              </Text>
              <Text size="xl" fw={700} mt="xs">
                {stats.todaySalesCount}
              </Text>
              <Text size="sm" c="dimmed">
                {stats.todayItemsSold} article{stats.todayItemsSold > 1 ? 's' : ''} vendu{stats.todayItemsSold > 1 ? 's' : ''}
              </Text>
            </div>
            <IconReceipt size={32} color="var(--mantine-color-blue-5)" />
          </Group>
        </Card>

        <Card withBorder padding="lg">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="sm" c="dimmed" tt="uppercase" fw={600}>
                CA aujourd'hui
              </Text>
              <Text size="xl" fw={700} mt="xs" c="green">
                {formatPrice(stats.todayRevenue)} €
              </Text>
              {stats.todayRefundsCount > 0 && (
                <Text size="sm" c="red">
                  {stats.todayRefundsCount} remboursement{stats.todayRefundsCount > 1 ? 's' : ''} (−{formatPrice(stats.todayRefundsAmount)} €)
                </Text>
              )}
            </div>
            <IconCash size={32} color="var(--mantine-color-green-5)" />
          </Group>
        </Card>

        <Card withBorder padding="lg">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="sm" c="dimmed" tt="uppercase" fw={600}>
                Panier moyen
              </Text>
              <Text size="xl" fw={700} mt="xs">
                {formatPrice(stats.todayAverageCart)} €
              </Text>
            </div>
            <IconTrendingUp size={32} color="var(--mantine-color-orange-5)" />
          </Group>
        </Card>

        <Card withBorder padding="lg">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="sm" c="dimmed" tt="uppercase" fw={600}>
                CA cette semaine
              </Text>
              <Text size="xl" fw={700} mt="xs">
                {formatPrice(stats.weekRevenue)} €
              </Text>
              <Text size="sm" c="dimmed">
                Ce mois : {formatPrice(stats.monthRevenue)} €
              </Text>
            </div>
            <IconCash size={32} color="var(--mantine-color-violet-5)" />
          </Group>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
