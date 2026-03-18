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
} from '@mantine/core';
import { IconPackage, IconArrowDown, IconArrowUp, IconCalendar } from '@tabler/icons-react';
import { createClient } from '@supabase/supabase-js';
import { useShop } from '@/context/ShopContext';
import { useLocation } from '@/context/LocationContext';

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
        <Title order={2}>Tableau de bord — Festivals</Title>
        <Text c="dimmed" size="sm">
          Vue d'ensemble des mouvements de stock
        </Text>
      </div>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <Card withBorder padding="lg">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="sm" c="dimmed" tt="uppercase" fw={600}>
                Sorties aujourd'hui
              </Text>
              <Text size="xl" fw={700} mt="xs">
                {stats.todayItemsOut}
              </Text>
              <Text size="sm" c="dimmed">
                article{stats.todayItemsOut > 1 ? 's' : ''}
              </Text>
            </div>
            <IconArrowDown size={32} color="var(--mantine-color-orange-5)" />
          </Group>
        </Card>

        <Card withBorder padding="lg">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="sm" c="dimmed" tt="uppercase" fw={600}>
                Retours aujourd'hui
              </Text>
              <Text size="xl" fw={700} mt="xs">
                {stats.todayItemsReturn}
              </Text>
              <Text size="sm" c="dimmed">
                article{stats.todayItemsReturn > 1 ? 's' : ''}
              </Text>
            </div>
            <IconArrowUp size={32} color="var(--mantine-color-blue-5)" />
          </Group>
        </Card>

        <Card withBorder padding="lg">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="sm" c="dimmed" tt="uppercase" fw={600}>
                Cette semaine
              </Text>
              <Text size="xl" fw={700} mt="xs">
                {stats.weekItemsOut}
              </Text>
              <Text size="sm" c="dimmed">
                article{stats.weekItemsOut > 1 ? 's' : ''} sorti{stats.weekItemsOut > 1 ? 's' : ''}
              </Text>
            </div>
            <IconCalendar size={32} color="var(--mantine-color-violet-5)" />
          </Group>
        </Card>

        <Card withBorder padding="lg">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="sm" c="dimmed" tt="uppercase" fw={600}>
                Ce mois
              </Text>
              <Text size="xl" fw={700} mt="xs">
                {stats.monthItemsOut}
              </Text>
              <Text size="sm" c="dimmed">
                article{stats.monthItemsOut > 1 ? 's' : ''} sorti{stats.monthItemsOut > 1 ? 's' : ''}
              </Text>
            </div>
            <IconPackage size={32} color="var(--mantine-color-green-5)" />
          </Group>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
