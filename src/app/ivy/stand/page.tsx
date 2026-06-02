'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ActionIcon, Button, Checkbox, Group, Loader, Paper, SimpleGrid, Table, Text, Tooltip } from '@mantine/core';
import {
  IconArrowDown,
  IconArrowUp,
  IconCalendar,
  IconLock,
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

interface AggregateStats {
  totalItemsOut: number;
  totalItemsReturn: number;
  topProducts: Array<{ name: string; quantity: number }>;
  topVariants: Array<{ name: string; quantity: number }>;
  topNames: Array<{ fullName: string; quantity: number }>;
  zonesCount: number;
  locationsCount: number;
}

export default function FestivalDashboardPage() {
  const { currentShop } = useShop();
  const { currentLocation, locations } = useLocation();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [aggStats, setAggStats] = useState<AggregateStats | null>(null);
  const [aggLoading, setAggLoading] = useState(false);

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

  // Signature stable de l'ensemble des emplacements (insensible à la ré-référence
  // du tableau `locations` par le contexte) — sert de dépendance d'effet.
  const locationsSig = locations.map(l => l.id).join(',');

  // Init : tous les emplacements cochés. Ne se déclenche QUE quand l'ensemble
  // d'IDs change réellement (premier chargement / changement de shop), donc ne
  // ré-écrase pas une dé-sélection manuelle de l'utilisateur.
  useEffect(() => {
    setSelectedLocationIds(locationsSig ? locationsSig.split(',') : []);
  }, [locationsSig]);

  // Charge l'agrégat cross-zones à chaque changement de sélection.
  // AbortController : évite qu'une réponse lente écrase une sélection plus récente.
  useEffect(() => {
    if (!currentShop?.id || locations.length === 0) return;
    if (selectedLocationIds.length === 0) { setAggStats(null); return; }

    const controller = new AbortController();
    const loadAgg = async () => {
      setAggLoading(true);
      try {
        const params = new URLSearchParams({
          shopId: currentShop.id,
          locationIds: selectedLocationIds.join(','),
        });
        const res = await fetch(`/api/pos/study-zones/aggregate-stats?${params}`, {
          signal: controller.signal,
        });
        const data = res.ok ? await res.json() : null;
        if (!controller.signal.aborted) setAggStats(data);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setAggStats(null);
        }
      } finally {
        if (!controller.signal.aborted) setAggLoading(false);
      }
    };
    loadAgg();
    return () => controller.abort();
  }, [currentShop?.id, selectedLocationIds, locations.length]);

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
      <Tooltip label="Comptes (privé)" position="left">
        <ActionIcon
          component={Link}
          href="/ivy/stand/comptes"
          variant="subtle"
          aria-label="Comptes"
          style={{ position: 'absolute', top: 8, right: 8, zIndex: 20, opacity: 0.25 }}
        >
          <IconLock size={16} />
        </ActionIcon>
      </Tooltip>
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

        <section className={styles.aggSection}>
          <div className={styles.pageHead}>
            <div className={styles.pageHeadLeft}>
              <h2 className={styles.title}>
                Tous les <em>festivals</em>
              </h2>
              <div className={styles.sub}>
                <span>Cumul de toutes les zones d&apos;étude</span>
              </div>
            </div>
          </div>

          <Paper withBorder p="md" radius="md" mb="md">
            <Group justify="space-between" mb="xs">
              <Text fw={600} size="sm">Emplacements</Text>
              <Group gap="xs">
                <Button size="xs" variant="subtle"
                  onClick={() => setSelectedLocationIds(locations.map(l => l.id))}>
                  Tout
                </Button>
                <Button size="xs" variant="subtle"
                  onClick={() => setSelectedLocationIds([])}>
                  Aucun
                </Button>
              </Group>
            </Group>
            <Checkbox.Group value={selectedLocationIds} onChange={setSelectedLocationIds}>
              <Group gap="md">
                {locations.map(loc => (
                  <Checkbox key={loc.id} value={loc.id} label={loc.name} />
                ))}
              </Group>
            </Checkbox.Group>
          </Paper>

          {selectedLocationIds.length === 0 ? (
            <div className={styles.errorWrap}>Sélectionnez au moins un emplacement.</div>
          ) : aggLoading ? (
            <div className={styles.loadingWrap}><Loader color="moss" /></div>
          ) : !aggStats || aggStats.zonesCount === 0 ? (
            <div className={styles.errorWrap}>Aucune zone d&apos;étude définie.</div>
          ) : (
            <>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" className={styles.metricsGrid}>
                <div className={styles.metricCard}>
                  <div className={styles.metricBody}>
                    <div className={styles.metricLabel}>Sorties (toutes zones)</div>
                    <div className={styles.metricValue}>
                      {aggStats.totalItemsOut.toLocaleString('fr-FR')}
                    </div>
                    <span className={styles.metricUnit}>
                      article{aggStats.totalItemsOut > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className={`${styles.metricIcon} ${styles.metricIcon_clay}`}>
                    <IconArrowDown size={20} />
                  </div>
                </div>
                <div className={styles.metricCard}>
                  <div className={styles.metricBody}>
                    <div className={styles.metricLabel}>Retours (toutes zones)</div>
                    <div className={`${styles.metricValue} ${styles.metricValueNeutral}`}>
                      {aggStats.totalItemsReturn.toLocaleString('fr-FR')}
                    </div>
                    <span className={styles.metricUnit}>
                      article{aggStats.totalItemsReturn > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className={`${styles.metricIcon} ${styles.metricIcon_slate}`}>
                    <IconArrowUp size={20} />
                  </div>
                </div>
              </SimpleGrid>

              <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md" mt="md">
                <Paper withBorder p="md" radius="md">
                  <Text fw={600} mb="sm">Fragments les plus sortis</Text>
                  <Table>
                    <Table.Thead>
                      <Table.Tr><Table.Th>Nom</Table.Th><Table.Th ta="right">Qté</Table.Th></Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {aggStats.topNames.slice(0, 15).map((n, i) => (
                        <Table.Tr key={i}>
                          <Table.Td>{n.fullName}</Table.Td>
                          <Table.Td ta="right">{n.quantity}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Paper>

                <Paper withBorder p="md" radius="md">
                  <Text fw={600} mb="sm">Produits les plus sortis</Text>
                  <Table>
                    <Table.Thead>
                      <Table.Tr><Table.Th>Produit</Table.Th><Table.Th ta="right">Qté</Table.Th></Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {aggStats.topProducts.slice(0, 15).map((p, i) => (
                        <Table.Tr key={i}>
                          <Table.Td>{p.name}</Table.Td>
                          <Table.Td ta="right">{p.quantity}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Paper>

                <Paper withBorder p="md" radius="md">
                  <Text fw={600} mb="sm">Variantes les plus sorties</Text>
                  <Table>
                    <Table.Thead>
                      <Table.Tr><Table.Th>Variante</Table.Th><Table.Th ta="right">Qté</Table.Th></Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {aggStats.topVariants.slice(0, 15).map((v, i) => (
                        <Table.Tr key={i}>
                          <Table.Td>{v.name}</Table.Td>
                          <Table.Td ta="right">{v.quantity}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Paper>
              </SimpleGrid>
            </>
          )}
        </section>
    </div>
  );
}
