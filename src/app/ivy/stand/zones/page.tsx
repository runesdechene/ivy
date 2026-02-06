'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Title,
  Text,
  Card,
  Group,
  Stack,
  SimpleGrid,
  Loader,
  Center,
  Button,
  Modal,
  TextInput,
  Table,
  Badge,
  ActionIcon,
  Avatar,
  Paper,
  Progress,
  Tooltip,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import {
  IconPlus,
  IconTrash,
  IconChartBar,
  IconTrophy,
  IconShoppingCart,
  IconCash,
  IconUsers,
  IconArrowLeft,
  IconCalendar,
} from '@tabler/icons-react';
import { createClient } from '@supabase/supabase-js';
import { useShop } from '@/context/ShopContext';
import { useLocation } from '@/context/LocationContext';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface StudyZone {
  id: string;
  name: string;
  date_from: string;
  date_to: string;
  created_at: string;
}

interface ZoneStats {
  zone: StudyZone;
  summary: {
    salesCount: number;
    refundsCount: number;
    totalRevenue: number;
    totalRefunds: number;
    totalDiscount: number;
    totalItemsSold: number;
    averageCart: number;
  };
  topProducts: Array<{ name: string; quantity: number; revenue: number }>;
  topVariants: Array<{ name: string; quantity: number; revenue: number }>;
  sellerLeaderboard: Array<{
    sellerId: string;
    name: string;
    initials: string | null;
    color: string | null;
    salesCount: number;
    revenue: number;
    itemsSold: number;
  }>;
  salesByDay: Array<{ date: string; salesCount: number; revenue: number; itemsSold: number }>;
}

export default function StudyZonesPage() {
  const { currentShop } = useShop();
  const { currentLocation } = useLocation();
  const [zones, setZones] = useState<StudyZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedZone, setSelectedZone] = useState<StudyZone | null>(null);
  const [zoneStats, setZoneStats] = useState<ZoneStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDateRange, setFormDateRange] = useState<[string | null, string | null]>([null, null]);
  const [creating, setCreating] = useState(false);

  const formatPrice = (price: number) =>
    price.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

  const fetchZones = useCallback(async () => {
    if (!currentShop) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/pos/study-zones?shopId=${currentShop.id}`);
      if (res.ok) {
        const data = await res.json();
        setZones(data.zones || []);
      }
    } catch (err) {
      console.error('Error fetching zones:', err);
    } finally {
      setLoading(false);
    }
  }, [currentShop]);

  useEffect(() => {
    fetchZones();
  }, [fetchZones]);

  const handleCreate = async () => {
    if (!currentShop || !formName.trim() || !formDateRange[0] || !formDateRange[1]) {
      notifications.show({ title: 'Erreur', message: 'Veuillez remplir tous les champs', color: 'red' });
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/pos/study-zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: currentShop.id,
          name: formName.trim(),
          dateFrom: formDateRange[0],
          dateTo: formDateRange[1],
        }),
      });

      if (res.ok) {
        notifications.show({ title: 'Succès', message: 'Zone d\'étude créée', color: 'green' });
        setCreateModalOpen(false);
        setFormName('');
        setFormDateRange([null, null]);
        fetchZones();
      } else {
        throw new Error('Failed to create');
      }
    } catch {
      notifications.show({ title: 'Erreur', message: 'Impossible de créer la zone', color: 'red' });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/pos/study-zones?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        notifications.show({ title: 'Supprimé', message: 'Zone d\'étude supprimée', color: 'green' });
        if (selectedZone?.id === id) {
          setSelectedZone(null);
          setZoneStats(null);
        }
        fetchZones();
      }
    } catch {
      notifications.show({ title: 'Erreur', message: 'Impossible de supprimer', color: 'red' });
    }
  };

  const loadStats = async (zone: StudyZone) => {
    if (!currentShop) return;
    setSelectedZone(zone);
    setLoadingStats(true);
    setZoneStats(null);

    try {
      let url = `/api/pos/study-zones/stats?shopId=${currentShop.id}&zoneId=${zone.id}`;
      if (currentLocation?.id) {
        url += `&locationId=${currentLocation.id}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setZoneStats(data);
      }
    } catch (err) {
      console.error('Error loading stats:', err);
    } finally {
      setLoadingStats(false);
    }
  };

  if (loading) {
    return (
      <Center h={400}>
        <Loader size="lg" />
      </Center>
    );
  }

  // Detail view
  if (selectedZone) {
    return (
      <Stack gap="lg">
        <Group>
          <ActionIcon variant="light" onClick={() => { setSelectedZone(null); setZoneStats(null); }}>
            <IconArrowLeft size={18} />
          </ActionIcon>
          <div>
            <Title order={2}>{selectedZone.name}</Title>
            <Text size="sm" c="dimmed">
              {formatDate(selectedZone.date_from)} — {formatDate(selectedZone.date_to)}
              {currentLocation && <Badge ml="xs" variant="light" size="sm">{currentLocation.name}</Badge>}
            </Text>
          </div>
        </Group>

        {loadingStats ? (
          <Center h={300}><Loader size="lg" /></Center>
        ) : zoneStats ? (
          <>
            {/* Summary cards */}
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
              <Card withBorder padding="lg">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Text size="sm" c="dimmed" tt="uppercase" fw={600}>Ventes</Text>
                    <Text size="xl" fw={700} mt="xs">{zoneStats.summary.salesCount}</Text>
                    {zoneStats.summary.refundsCount > 0 && (
                      <Text size="xs" c="red">{zoneStats.summary.refundsCount} remboursement(s)</Text>
                    )}
                  </div>
                  <IconShoppingCart size={28} color="var(--mantine-color-blue-5)" />
                </Group>
              </Card>

              <Card withBorder padding="lg">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Text size="sm" c="dimmed" tt="uppercase" fw={600}>Chiffre d'affaires</Text>
                    <Text size="xl" fw={700} mt="xs" c="green">{formatPrice(zoneStats.summary.totalRevenue)} €</Text>
                    {zoneStats.summary.totalDiscount > 0 && (
                      <Text size="xs" c="dimmed">dont {formatPrice(zoneStats.summary.totalDiscount)} € de remises</Text>
                    )}
                  </div>
                  <IconCash size={28} color="var(--mantine-color-green-5)" />
                </Group>
              </Card>

              <Card withBorder padding="lg">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Text size="sm" c="dimmed" tt="uppercase" fw={600}>Articles vendus</Text>
                    <Text size="xl" fw={700} mt="xs">{zoneStats.summary.totalItemsSold}</Text>
                  </div>
                  <IconChartBar size={28} color="var(--mantine-color-orange-5)" />
                </Group>
              </Card>

              <Card withBorder padding="lg">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Text size="sm" c="dimmed" tt="uppercase" fw={600}>Panier moyen</Text>
                    <Text size="xl" fw={700} mt="xs">{formatPrice(zoneStats.summary.averageCart)} €</Text>
                  </div>
                  <IconCash size={28} color="var(--mantine-color-violet-5)" />
                </Group>
              </Card>
            </SimpleGrid>

            {/* Seller leaderboard */}
            {zoneStats.sellerLeaderboard.length > 0 && (
              <Card withBorder padding="lg">
                <Group mb="md">
                  <IconTrophy size={20} color="var(--mantine-color-yellow-6)" />
                  <Text fw={600}>Classement vendeurs</Text>
                </Group>
                <Stack gap="sm">
                  {zoneStats.sellerLeaderboard.map((seller, i) => {
                    const maxRevenue = zoneStats.sellerLeaderboard[0]?.revenue || 1;
                    return (
                      <Group key={seller.sellerId} gap="sm" wrap="nowrap">
                        <Text fw={700} size="lg" w={24} ta="center" c={i === 0 ? 'yellow.6' : 'dimmed'}>
                          {i + 1}
                        </Text>
                        <Avatar
                          size="sm"
                          radius="xl"
                          style={{ backgroundColor: seller.color || 'var(--mantine-color-gray-5)' }}
                        >
                          {seller.initials || seller.name.charAt(0).toUpperCase()}
                        </Avatar>
                        <div style={{ flex: 1 }}>
                          <Group justify="space-between" mb={4}>
                            <Text size="sm" fw={500}>{seller.name}</Text>
                            <Group gap="xs">
                              <Badge variant="light" size="sm">{seller.salesCount} vente(s)</Badge>
                              <Badge variant="light" color="green" size="sm">{formatPrice(seller.revenue)} €</Badge>
                            </Group>
                          </Group>
                          <Progress
                            value={(seller.revenue / maxRevenue) * 100}
                            size="sm"
                            color={i === 0 ? 'yellow' : i === 1 ? 'gray' : 'orange'}
                          />
                        </div>
                      </Group>
                    );
                  })}
                </Stack>
              </Card>
            )}

            <SimpleGrid cols={{ base: 1, md: 2 }}>
              {/* Top products */}
              <Card withBorder padding="lg">
                <Text fw={600} mb="md">Produits les plus vendus</Text>
                {zoneStats.topProducts.length === 0 ? (
                  <Text c="dimmed" size="sm">Aucune donnée</Text>
                ) : (
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Produit</Table.Th>
                        <Table.Th style={{ textAlign: 'right' }}>Qté</Table.Th>
                        <Table.Th style={{ textAlign: 'right' }}>CA</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {zoneStats.topProducts.map((p, i) => (
                        <Table.Tr key={i}>
                          <Table.Td><Text size="sm">{p.name}</Text></Table.Td>
                          <Table.Td style={{ textAlign: 'right' }}>
                            <Badge variant="light" size="sm">{p.quantity}</Badge>
                          </Table.Td>
                          <Table.Td style={{ textAlign: 'right' }}>
                            <Text size="sm" fw={500}>{formatPrice(p.revenue)} €</Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </Card>

              {/* Top variants */}
              <Card withBorder padding="lg">
                <Text fw={600} mb="md">Variantes les plus vendues</Text>
                {zoneStats.topVariants.length === 0 ? (
                  <Text c="dimmed" size="sm">Aucune donnée</Text>
                ) : (
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Variante</Table.Th>
                        <Table.Th style={{ textAlign: 'right' }}>Qté</Table.Th>
                        <Table.Th style={{ textAlign: 'right' }}>CA</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {zoneStats.topVariants.map((v, i) => (
                        <Table.Tr key={i}>
                          <Table.Td><Text size="sm">{v.name}</Text></Table.Td>
                          <Table.Td style={{ textAlign: 'right' }}>
                            <Badge variant="light" size="sm">{v.quantity}</Badge>
                          </Table.Td>
                          <Table.Td style={{ textAlign: 'right' }}>
                            <Text size="sm" fw={500}>{formatPrice(v.revenue)} €</Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </Card>
            </SimpleGrid>

            {/* Sales by day */}
            {zoneStats.salesByDay.length > 0 && (
              <Card withBorder padding="lg">
                <Text fw={600} mb="md">Ventes par jour</Text>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Date</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Ventes</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Articles</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>CA</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {zoneStats.salesByDay.map((day, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>{formatDate(day.date)}</Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>{day.salesCount}</Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>{day.itemsSold}</Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          <Text fw={500}>{formatPrice(day.revenue)} €</Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Card>
            )}
          </>
        ) : (
          <Text c="dimmed">Impossible de charger les statistiques</Text>
        )}
      </Stack>
    );
  }

  // List view
  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Title order={2}>Zones d'étude</Title>
          <Text c="dimmed" size="sm">
            Créez des zones d'étude pour analyser les ventes sur une période donnée
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateModalOpen(true)}>
          Créer une zone d'étude
        </Button>
      </Group>

      {zones.length === 0 ? (
        <Paper withBorder p="xl" radius="md">
          <Center>
            <Stack align="center" gap="sm">
              <IconChartBar size={48} color="var(--mantine-color-gray-4)" />
              <Text c="dimmed">Aucune zone d'étude créée</Text>
              <Text c="dimmed" size="sm">
                Créez une zone pour analyser vos ventes sur une période (festival, marché, etc.)
              </Text>
            </Stack>
          </Center>
        </Paper>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {zones.map(zone => (
            <Card
              key={zone.id}
              withBorder
              padding="lg"
              radius="md"
              style={{ cursor: 'pointer' }}
              onClick={() => loadStats(zone)}
            >
              <Group justify="space-between" mb="xs">
                <Text fw={600} size="lg">{zone.name}</Text>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); handleDelete(zone.id); }}
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
              <Group gap="xs">
                <IconCalendar size={14} color="var(--mantine-color-dimmed)" />
                <Text size="sm" c="dimmed">
                  {formatDate(zone.date_from)} — {formatDate(zone.date_to)}
                </Text>
              </Group>
            </Card>
          ))}
        </SimpleGrid>
      )}

      {/* Create modal */}
      <Modal
        opened={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Créer une zone d'étude"
        centered
      >
        <Stack gap="md">
          <TextInput
            label="Nom"
            placeholder="Ex: Festival Yggdrasil, Marché de Noël..."
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            required
          />
          <DatePickerInput
            type="range"
            label="Période"
            placeholder="Sélectionnez une plage de dates"
            valueFormat="DD/MM/YYYY"
            value={formDateRange}
            onChange={(val) => setFormDateRange(val as [string | null, string | null])}
            locale="fr"
            required
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setCreateModalOpen(false)}>Annuler</Button>
            <Button onClick={handleCreate} loading={creating}>Créer</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
