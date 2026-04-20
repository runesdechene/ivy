'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader, Modal, TextInput, Stack } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import {
  IconPlus,
  IconTrash,
  IconChartBar,
  IconArrowLeft,
  IconCalendar,
  IconArrowDown,
  IconArrowUp,
  IconMapPin,
} from '@tabler/icons-react';
import { useShop } from '@/context/ShopContext';
import { useLocation } from '@/context/LocationContext';
import { StatusBadge } from '@/components/StatusBadge';
import styles from './zones.module.scss';

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

  const isZoneActive = (zone: StudyZone) => {
    const now = new Date();
    const from = new Date(zone.date_from);
    const to = new Date(zone.date_to);
    return now >= from && now <= to;
  };

  const isZonePast = (zone: StudyZone) => {
    const now = new Date();
    const to = new Date(zone.date_to);
    return now > to;
  };

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

  // ---------------------------------------------------------------------------
  // Detail view
  // ---------------------------------------------------------------------------
  if (selectedZone) {
    const renderQtyRow = (label: string, qty: number, key: string | number) => (
      <tr key={key} className={styles.tr}>
        <td className={styles.td}>
          <span className={styles.cellName}>{label}</span>
        </td>
        <td className={`${styles.td} ${styles.tdRight}`}>
          <span className={styles.cellQty}>{qty}</span>
        </td>
      </tr>
    );

    return (
      <div className={styles.container}>
        <div className={styles.detailHead}>
          <button
            type="button"
            className={styles.backButton}
            onClick={() => { setSelectedZone(null); setZoneStats(null); }}
            aria-label="Retour"
          >
            <IconArrowLeft size={18} />
          </button>
          <div className={styles.detailHeadInfo}>
            <h1 className={styles.detailTitle}>{selectedZone.name}</h1>
            <div className={styles.detailRange}>
              <span>
                {formatDate(selectedZone.date_from)} — {formatDate(selectedZone.date_to)}
              </span>
              {isZoneActive(selectedZone) && (
                <StatusBadge variant="moss">Active</StatusBadge>
              )}
              {isZonePast(selectedZone) && (
                <StatusBadge variant="slate">Passée</StatusBadge>
              )}
              {currentLocation && (
                <span className={styles.locationChip}>
                  <IconMapPin size={11} />
                  {currentLocation.name}
                </span>
              )}
            </div>
          </div>
        </div>

        {loadingStats ? (
          <div className={styles.loadingWrap}>
            <Loader color="moss" />
          </div>
        ) : zoneStats ? (
          <>
            {/* Summary cards */}
            <div className={styles.summaryGrid}>
              <div className={styles.metricCard}>
                <div className={styles.metricBody}>
                  <div className={styles.metricLabel}>Articles sortis</div>
                  <div className={`${styles.metricValue} ${styles.metricValue_moss}`}>
                    {zoneStats.summary.totalItemsOut.toLocaleString('fr-FR')}
                  </div>
                </div>
                <div className={`${styles.metricIcon} ${styles.metricIcon_clay}`}>
                  <IconArrowDown size={20} />
                </div>
              </div>

              <div className={styles.metricCard}>
                <div className={styles.metricBody}>
                  <div className={styles.metricLabel}>Retours</div>
                  <div className={`${styles.metricValue} ${styles.metricValue_plum}`}>
                    {zoneStats.summary.totalItemsReturn.toLocaleString('fr-FR')}
                  </div>
                </div>
                <div className={`${styles.metricIcon} ${styles.metricIcon_plum}`}>
                  <IconArrowUp size={20} />
                </div>
              </div>
            </div>

            {/* Top products / Top variants */}
            <div className={styles.panelsGrid}>
              <div className={styles.panel}>
                <div className={styles.panelHead}>
                  <h2 className={styles.panelTitle}>
                    Produits <em>les plus sortis</em>
                  </h2>
                </div>
                {zoneStats.topProducts.length === 0 ? (
                  <div className={styles.panelEmpty}>Aucune donnée</div>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th className={styles.th}>Produit</th>
                          <th className={`${styles.th} ${styles.thRight}`}>Quantité</th>
                        </tr>
                      </thead>
                      <tbody>
                        {zoneStats.topProducts.map((p, i) => renderQtyRow(p.name, p.quantity, i))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className={styles.panel}>
                <div className={styles.panelHead}>
                  <h2 className={styles.panelTitle}>
                    Variantes <em>les plus sorties</em>
                  </h2>
                </div>
                {zoneStats.topVariants.length === 0 ? (
                  <div className={styles.panelEmpty}>Aucune donnée</div>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th className={styles.th}>Variante</th>
                          <th className={`${styles.th} ${styles.thRight}`}>Quantité</th>
                        </tr>
                      </thead>
                      <tbody>
                        {zoneStats.topVariants.map((v, i) => renderQtyRow(v.name, v.quantity, i))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Options by category + Top names */}
            {(zoneStats.topOptionsByCategory.length > 0 || zoneStats.topNames.length > 0) && (
              <div className={styles.panelsGrid}>
                {zoneStats.topOptionsByCategory.map((cat, i) => (
                  <div key={i} className={styles.panel}>
                    <div className={styles.panelHead}>
                      <h2 className={styles.panelTitle}>
                        {cat.category}
                      </h2>
                    </div>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th className={styles.th}>{cat.category}</th>
                            <th className={`${styles.th} ${styles.thRight}`}>Quantité</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cat.options.map((o, j) => renderQtyRow(o.name, o.quantity, j))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                {zoneStats.topNames.length > 0 && (
                  <div className={styles.panel}>
                    <div className={styles.panelHead}>
                      <h2 className={styles.panelTitle}>
                        Fragments <em>les plus sortis</em>
                      </h2>
                    </div>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th className={styles.th}>Nom</th>
                            <th className={`${styles.th} ${styles.thRight}`}>Quantité</th>
                          </tr>
                        </thead>
                        <tbody>
                          {zoneStats.topNames.map((n, i) => renderQtyRow(n.fullName, n.quantity, i))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Movements by day */}
            {zoneStats.movementsByDay.length > 0 && (
              <div className={styles.panel}>
                <div className={styles.panelHead}>
                  <h2 className={styles.panelTitle}>
                    Mouvements <em>par jour</em>
                  </h2>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.th}>Date</th>
                        <th className={`${styles.th} ${styles.thRight}`}>Sorties</th>
                        <th className={`${styles.th} ${styles.thRight}`}>Retours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zoneStats.movementsByDay.map((day, i) => (
                        <tr key={i} className={styles.tr}>
                          <td className={styles.td}>
                            <span className={styles.cellDate}>{formatDate(day.date)}</span>
                          </td>
                          <td className={`${styles.td} ${styles.tdRight}`}>
                            <span className={`${styles.cellQty} ${day.itemsOut === 0 ? styles.cellQtyMuted : ''}`}>
                              {day.itemsOut > 0 ? day.itemsOut : '—'}
                            </span>
                          </td>
                          <td className={`${styles.td} ${styles.tdRight}`}>
                            <span className={`${styles.cellQty} ${styles.cellQtyReturn} ${day.itemsReturn === 0 ? styles.cellQtyMuted : ''}`}>
                              {day.itemsReturn > 0 ? `+${day.itemsReturn}` : '—'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className={styles.errorWrap}>
            Impossible de charger les statistiques
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // List view
  // ---------------------------------------------------------------------------
  return (
    <div className={styles.container}>
      <div className={styles.pageHead}>
        <div className={styles.pageHeadLeft}>
          <div className={styles.eyebrow}>Festivals · {shopName}</div>
          <h1 className={styles.title}>
            Zones <em>d&apos;étude</em>
          </h1>
          <div className={styles.sub}>
            <span>
              {zones.length === 0
                ? 'Aucune zone définie'
                : `${zones.length} zone${zones.length > 1 ? 's' : ''} définie${zones.length > 1 ? 's' : ''}`}
            </span>
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
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => setCreateModalOpen(true)}
        >
          <IconPlus size={16} />
          Créer une zone
        </button>
      </div>

      {zones.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyStateIcon}>
            <IconChartBar size={42} />
          </div>
          <div className={styles.emptyStateTitle}>
            Aucune zone <em>d&apos;étude</em>
          </div>
          <div className={styles.emptyStateHint}>
            Créez une zone pour analyser vos mouvements de stock sur une
            période — festival, marché, événement.
          </div>
        </div>
      ) : (
        <div className={styles.zonesGrid}>
          {zones.map(zone => {
            const active = isZoneActive(zone);
            const past = isZonePast(zone);
            return (
              <div
                key={zone.id}
                className={styles.zoneCard}
                onClick={() => loadStats(zone)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    loadStats(zone);
                  }
                }}
              >
                <div className={styles.zoneCardHead}>
                  <h3 className={styles.zoneName}>{zone.name}</h3>
                  <button
                    type="button"
                    className={styles.zoneDeleteBtn}
                    onClick={(e) => { e.stopPropagation(); handleDelete(zone.id); }}
                    aria-label="Supprimer la zone"
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
                <div className={styles.zoneRange}>
                  <IconCalendar size={14} />
                  <span>{formatDate(zone.date_from)} — {formatDate(zone.date_to)}</span>
                </div>
                {active && <StatusBadge variant="moss">Active</StatusBadge>}
                {past && <StatusBadge variant="slate">Passée</StatusBadge>}
              </div>
            );
          })}
        </div>
      )}

      {/* Create modal */}
      <Modal
        opened={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title={<span className={styles.modalTitle}>Créer une zone d&apos;étude</span>}
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
          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setCreateModalOpen(false)}
            >
              Annuler
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? 'Création…' : 'Créer'}
            </button>
          </div>
        </Stack>
      </Modal>
    </div>
  );
}
