'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Title, Text, Paper, Stack, Group, SimpleGrid, Loader, Center, 
  Progress, Badge, ThemeIcon
} from '@mantine/core';
import { 
  IconPackage, IconCurrencyEuro, IconPalette, IconRuler2, 
  IconChartBar, IconTrendingUp, IconMapPin
} from '@tabler/icons-react';
import { useShop } from '@/context/ShopContext';
import { useLocation } from '@/context/LocationContext';
import { getColorHex, loadColorMappingsFromSupabase } from '@/utils/color-transformer';

interface Stats {
  totalVariants: number;
  totalStock: number;
  totalStockValue: number;
  byProductType: Record<string, { count: number; stock: number; value: number }>;
  byColor: Record<string, { count: number; stock: number }>;
  bySize: Record<string, { count: number; stock: number }>;
  topProducts: { title: string; stock: number; value: number }[];
}

export default function InventaireDashboardPage() {
  const { currentShop } = useShop();
  const { currentLocation } = useLocation();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);

  const fetchStats = useCallback(async () => {
    if (!currentShop) return;
    
    setLoading(true);
    try {
      await loadColorMappingsFromSupabase(currentShop.id);
      
      const params = new URLSearchParams({ shopId: currentShop.id });
      if (currentLocation?.id) {
        params.append('locationId', currentLocation.id);
      }
      
      const response = await fetch(`/api/inventory/stats?${params}`);
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    } finally {
      setLoading(false);
    }
  }, [currentShop, currentLocation]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <Center h={400}>
        <Loader size="lg" />
      </Center>
    );
  }

  if (!stats) {
    return (
      <Center h={400}>
        <Text c="dimmed">Impossible de charger les statistiques</Text>
      </Center>
    );
  }

  const maxStock = Math.max(...Object.values(stats.byProductType).map(t => t.stock), 1);
  const maxColorStock = Math.max(...Object.values(stats.byColor).map(c => c.stock), 1);

  // Ordre des tailles pour le tri
  const sizeOrder = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'];
  const sortedSizes = Object.entries(stats.bySize).sort((a, b) => {
    const indexA = sizeOrder.indexOf(a[0]);
    const indexB = sizeOrder.indexOf(b[0]);
    if (indexA === -1 && indexB === -1) return a[0].localeCompare(b[0]);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });
  const maxSizeStock = Math.max(...sortedSizes.map(([, s]) => s.stock), 1);

  return (
    <div>
      <Group justify="space-between" mb="xl">
        <Title order={2}>Tableau de bord inventaire</Title>
        {currentLocation && (
          <Badge variant="light" color="green" size="lg" leftSection={<IconMapPin size={14} />}>
            {currentLocation.name}
          </Badge>
        )}
      </Group>

      {/* Cartes principales */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md" mb="xl">
        <Paper withBorder p="md" radius="md">
          <Group justify="space-between">
            <div>
              <Text c="dimmed" size="xs" tt="uppercase" fw={700}>
                Variantes en stock
              </Text>
              <Text fw={700} size="xl">
                {stats.totalVariants.toLocaleString('fr-FR')}
              </Text>
            </div>
            <ThemeIcon color="blue" variant="light" size={48} radius="md">
              <IconPackage size={24} />
            </ThemeIcon>
          </Group>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Group justify="space-between">
            <div>
              <Text c="dimmed" size="xs" tt="uppercase" fw={700}>
                Unités en stock
              </Text>
              <Text fw={700} size="xl">
                {stats.totalStock.toLocaleString('fr-FR')}
              </Text>
            </div>
            <ThemeIcon color="teal" variant="light" size={48} radius="md">
              <IconChartBar size={24} />
            </ThemeIcon>
          </Group>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Group justify="space-between">
            <div>
              <Text c="dimmed" size="xs" tt="uppercase" fw={700}>
                Valeur estimée
              </Text>
              <Text fw={700} size="xl">
                {stats.totalStockValue.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €
              </Text>
            </div>
            <ThemeIcon color="green" variant="light" size={48} radius="md">
              <IconCurrencyEuro size={24} />
            </ThemeIcon>
          </Group>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Group justify="space-between">
            <div>
              <Text c="dimmed" size="xs" tt="uppercase" fw={700}>
                Types de produits
              </Text>
              <Text fw={700} size="xl">
                {Object.keys(stats.byProductType).length}
              </Text>
            </div>
            <ThemeIcon color="violet" variant="light" size={48} radius="md">
              <IconTrendingUp size={24} />
            </ThemeIcon>
          </Group>
        </Paper>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md" mb="xl">
        {/* Stock par type de produit */}
        <Paper withBorder p="md" radius="md">
          <Group mb="md">
            <IconPackage size={20} />
            <Text fw={600}>Stock par type de produit</Text>
          </Group>
          <Stack gap="xs">
            {Object.entries(stats.byProductType).slice(0, 8).map(([type, data]) => (
              <div key={type}>
                <Group justify="space-between" mb={4}>
                  <Text size="sm" fw={500}>{type}</Text>
                  <Group gap="xs">
                    <Badge size="sm" variant="light">
                      {data.stock.toLocaleString('fr-FR')} unités
                    </Badge>
                    <Badge size="sm" variant="light" color="green">
                      {data.value.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €
                    </Badge>
                  </Group>
                </Group>
                <Progress 
                  value={(data.stock / maxStock) * 100} 
                  size="sm" 
                  color="blue"
                />
              </div>
            ))}
          </Stack>
        </Paper>

        {/* Top produits */}
        <Paper withBorder p="md" radius="md">
          <Group mb="md">
            <IconTrendingUp size={20} />
            <Text fw={600}>Top 10 produits en stock</Text>
          </Group>
          <Stack gap="xs">
            {stats.topProducts.slice(0, 10).map((product, index) => (
              <Group key={product.title} justify="space-between">
                <Group gap="xs">
                  <Badge size="sm" variant="filled" color="gray" circle>
                    {index + 1}
                  </Badge>
                  <Text size="sm" lineClamp={1} style={{ maxWidth: 200 }}>
                    {product.title}
                  </Text>
                </Group>
                <Group gap="xs">
                  <Badge size="sm" variant="light">
                    {product.stock.toLocaleString('fr-FR')}
                  </Badge>
                  <Badge size="sm" variant="light" color="green">
                    {product.value.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €
                  </Badge>
                </Group>
              </Group>
            ))}
          </Stack>
        </Paper>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        {/* Couleurs les plus présentes */}
        <Paper withBorder p="md" radius="md">
          <Group mb="md">
            <IconPalette size={20} />
            <Text fw={600}>Couleurs les plus présentes</Text>
          </Group>
          <Stack gap="xs">
            {Object.entries(stats.byColor).slice(0, 12).map(([color, data]) => {
              const hex = getColorHex(color);
              return (
                <div key={color}>
                  <Group justify="space-between" mb={4}>
                    <Group gap="xs">
                      {hex && hex !== '#808080' && (
                        <div
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: '50%',
                            background: hex,
                            border: '1px solid #ddd',
                          }}
                        />
                      )}
                      <Text size="sm" fw={500}>{color}</Text>
                    </Group>
                    <Badge size="sm" variant="light">
                      {data.stock.toLocaleString('fr-FR')} unités
                    </Badge>
                  </Group>
                  <Progress 
                    value={(data.stock / maxColorStock) * 100} 
                    size="sm" 
                    color={hex && hex !== '#808080' ? undefined : 'gray'}
                    styles={hex && hex !== '#808080' ? {
                      section: { backgroundColor: hex }
                    } : undefined}
                  />
                </div>
              );
            })}
          </Stack>
        </Paper>

        {/* Tailles les plus présentes */}
        <Paper withBorder p="md" radius="md">
          <Group mb="md">
            <IconRuler2 size={20} />
            <Text fw={600}>Répartition par taille</Text>
          </Group>
          <Stack gap="xs">
            {sortedSizes.map(([size, data]) => (
              <div key={size}>
                <Group justify="space-between" mb={4}>
                  <Badge size="md" variant="filled" color="blue">
                    {size}
                  </Badge>
                  <Badge size="sm" variant="light">
                    {data.stock.toLocaleString('fr-FR')} unités
                  </Badge>
                </Group>
                <Progress 
                  value={(data.stock / maxSizeStock) * 100} 
                  size="sm" 
                  color="blue"
                />
              </div>
            ))}
          </Stack>
        </Paper>
      </SimpleGrid>
    </div>
  );
}
