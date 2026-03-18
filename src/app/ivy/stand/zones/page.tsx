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
  Paper,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import {
  IconPlus,
  IconTrash,
  IconChartBar,
  IconPackage,
  IconArrowLeft,
  IconCalendar,
  IconArrowDown,
  IconArrowUp,
} from '@tabler/icons-react';
import { useShop } from '@/context/ShopContext';
import { useLocation } from '@/context/LocationContext';

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
    totalItemsOut: number;
    totalItemsReturn: number;
  };
  topProducts: Array<{ name: string; quantity: number }>;
  topVariants: Array<{ name: string; quantity: number }>;
  topOptionsByCategory: Array<{ category: string; options: Array<{ name: string; quantity: number }> }>;
  topNames: Array<{ fullName: string; quantity: number }>;
  movementsByDay: Array<{ date: string; itemsOut: number; itemsReturn: number }>;
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
      } else {
        // Show empty stats instead of error
        setZoneStats({
          zone,
          summary: { totalItemsOut: 0, totalItemsReturn: 0 },
          topProducts: [],
          topVariants: [],
          topOptionsByCategory: [],
          topNames: [],
          movementsByDay: [],
        });
      }
    } catch (err) {
      console.error('Error loading stats:', err);
      setZoneStats({
        zone,
        summary: { totalItemsOut: 0, totalItemsReturn: 0 },
        topProducts: [],
        topVariants: [],
        topOptionsByCategory: [],
        topNames: [],
        movementsByDay: [],
      });
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
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Card withBorder padding="lg">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Text size="sm" c="dimmed" tt="uppercase" fw={600}>Articles sortis</Text>
                    <Text size="xl" fw={700} mt="xs">{zoneStats.summary.totalItemsOut}</Text>
                  </div>
                  <IconArrowDown size={28} color="var(--mantine-color-orange-5)" />
                </Group>
              </Card>

              <Card withBorder padding="lg">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Text size="sm" c="dimmed" tt="uppercase" fw={600}>Retours</Text>
                    <Text size="xl" fw={700} mt="xs">{zoneStats.summary.totalItemsReturn}</Text>
                  </div>
                  <IconArrowUp size={28} color="var(--mantine-color-blue-5)" />
                </Group>
              </Card>
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, md: 2 }}>
              {/* Top products */}
              <Card withBorder padding="lg">
                <Text fw={600} mb="md">Produits les plus sortis</Text>
                {zoneStats.topProducts.length === 0 ? (
                  <Text c="dimmed" size="sm">Aucune donnée</Text>
                ) : (
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Produit</Table.Th>
                        <Table.Th style={{ textAlign: 'right' }}>Quantité</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {zoneStats.topProducts.map((p, i) => (
                        <Table.Tr key={i}>
                          <Table.Td><Text size="sm">{p.name}</Text></Table.Td>
                          <Table.Td style={{ textAlign: 'right' }}>
                            <Badge variant="light" size="sm">{p.quantity}</Badge>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </Card>

              {/* Top variants */}
              <Card withBorder padding="lg">
                <Text fw={600} mb="md">Variantes les plus sorties</Text>
                {zoneStats.topVariants.length === 0 ? (
                  <Text c="dimmed" size="sm">Aucune donnée</Text>
                ) : (
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Variante</Table.Th>
                        <Table.Th style={{ textAlign: 'right' }}>Quantité</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {zoneStats.topVariants.map((v, i) => (
                        <Table.Tr key={i}>
                          <Table.Td><Text size="sm">{v.name}</Text></Table.Td>
                          <Table.Td style={{ textAlign: 'right' }}>
                            <Badge variant="light" size="sm">{v.quantity}</Badge>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </Card>
            </SimpleGrid>

            {/* Options by category (Couleur, Taille, etc.) + Top names */}
            <SimpleGrid cols={{ base: 1, md: zoneStats.topOptionsByCategory.length + (zoneStats.topNames.length > 0 ? 1 : 0) > 3 ? 2 : zoneStats.topOptionsByCategory.length + (zoneStats.topNames.length > 0 ? 1 : 0) }}>
              {zoneStats.topOptionsByCategory.map((cat, i) => (
                <Card key={i} withBorder padding="lg">
                  <Text fw={600} mb="md">{cat.category}</Text>
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{cat.category}</Table.Th>
                        <Table.Th style={{ textAlign: 'right' }}>Quantité</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {cat.options.map((o, j) => (
                        <Table.Tr key={j}>
                          <Table.Td><Text size="sm">{o.name}</Text></Table.Td>
                          <Table.Td style={{ textAlign: 'right' }}>
                            <Badge variant="light" size="sm">{o.quantity}</Badge>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Card>
              ))}

              {/* Top names (grouped by prefix) */}
              {zoneStats.topNames.length > 0 && (
                <Card withBorder padding="lg">
                  <Text fw={600} mb="md">Fragments les plus sortis</Text>
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Nom</Table.Th>
                        <Table.Th style={{ textAlign: 'right' }}>Quantité</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {zoneStats.topNames.map((n, i) => (
                        <Table.Tr key={i}>
                          <Table.Td><Text size="sm">{n.fullName}</Text></Table.Td>
                          <Table.Td style={{ textAlign: 'right' }}>
                            <Badge variant="light" size="sm">{n.quantity}</Badge>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Card>
              )}
            </SimpleGrid>

            {/* Movements by day */}
            {zoneStats.movementsByDay.length > 0 && (
              <Card withBorder padding="lg">
                <Text fw={600} mb="md">Mouvements par jour</Text>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Date</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Sorties</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Retours</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {zoneStats.movementsByDay.map((day, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>{formatDate(day.date)}</Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>{day.itemsOut}</Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          {day.itemsReturn > 0 ? `+${day.itemsReturn}` : '—'}
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
            Créez des zones d'étude pour analyser les mouvements de stock sur une période
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
                Créez une zone pour analyser vos mouvements de stock sur une période (festival, marché, etc.)
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
