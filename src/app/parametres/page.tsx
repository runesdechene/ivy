'use client';

import { useState, useEffect, useCallback } from 'react';
import { Stack, TextInput, NumberInput, Loader, Group } from '@mantine/core';
import { IconPlus, IconTrash, IconMapPin } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useShop } from '@/context/ShopContext';
import styles from './parametres.module.scss';

interface Location {
  id: string;
  name: string;
}

interface OrderSettings {
  printer_notes: string[];
  sync_location_ids: string[];
  handling_fee: number;
}

export default function CommandesSettingsPage() {
  const { currentShop } = useShop();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [orderSettings, setOrderSettings] = useState<OrderSettings>({ printer_notes: [], sync_location_ids: [], handling_fee: 0 });
  const [locations, setLocations] = useState<Location[]>([]);
  const [newPrinterNote, setNewPrinterNote] = useState('');

  const fetchSettings = useCallback(async () => {
    if (!currentShop) return;

    setLoading(true);
    try {
      const [orderSettingsRes, locationsRes] = await Promise.all([
        fetch(`/api/settings/orders?shopId=${currentShop.id}`),
        fetch(`/api/locations?shopId=${currentShop.id}`),
      ]);

      if (orderSettingsRes.ok) {
        const data = await orderSettingsRes.json();
        setOrderSettings(data.settings || { printer_notes: [], sync_location_ids: [], handling_fee: 0 });
      }

      if (locationsRes.ok) {
        const data = await locationsRes.json();
        setLocations(data.locations || []);
      }
    } catch (err) {
      console.error('Error fetching settings:', err);
    } finally {
      setLoading(false);
    }
  }, [currentShop]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const saveOrderSettings = async (settings: OrderSettings) => {
    if (!currentShop) return;

    setSaving(true);
    try {
      const response = await fetch('/api/settings/orders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: currentShop.id,
          printerNotes: settings.printer_notes,
          syncLocationIds: settings.sync_location_ids,
          handlingFee: settings.handling_fee,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setOrderSettings(data.settings);
        notifications.show({
          title: 'Enregistré',
          message: 'Paramètres sauvegardés',
          color: 'moss',
        });
      }
    } catch (err) {
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de sauvegarder les paramètres',
        color: 'rust',
      });
    } finally {
      setSaving(false);
    }
  };

  const addPrinterNote = async () => {
    if (!newPrinterNote.trim()) return;

    const updatedNotes = [...orderSettings.printer_notes, newPrinterNote.trim()];
    await saveOrderSettings({ ...orderSettings, printer_notes: updatedNotes });
    setNewPrinterNote('');
  };

  const removePrinterNote = async (index: number) => {
    const updatedNotes = orderSettings.printer_notes.filter((_, i) => i !== index);
    await saveOrderSettings({ ...orderSettings, printer_notes: updatedNotes });
  };

  const toggleSyncLocation = async (locationId: string) => {
    const currentIds = orderSettings.sync_location_ids || [];
    const updatedIds = currentIds.includes(locationId)
      ? currentIds.filter(id => id !== locationId)
      : [...currentIds, locationId];

    await saveOrderSettings({ ...orderSettings, sync_location_ids: updatedIds });
  };

  const shopName = currentShop?.name || 'Runes de Chêne';

  if (loading) {
    return (
      <div className={styles.loadingWrap}>
        <Loader size="lg" />
      </div>
    );
  }

  return (
    <div>
      <div className={styles.pageHead}>
        <div className={styles.pageHeadLeft}>
          <div className={styles.eyebrow}>Paramètres · {shopName}</div>
          <h1 className={styles.title}>
            Commandes <em>générales</em>
          </h1>
          <div className={styles.sub}>
            Rappels imprimeur, frais de manutention, emplacements
          </div>
        </div>
      </div>

      <Stack gap="lg">
        {/* Notes pour l'imprimeur */}
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h3 className={styles.cardHeadTitle}>Notes pour l&apos;imprimeur</h3>
              <p className={styles.cardHeadSub}>
                Ces rappels seront affichés en haut de la page des commandes boutique
              </p>
            </div>
          </div>
          <div className={styles.cardBody}>
            <Group mb="md" gap="sm">
              <TextInput
                placeholder="Ajouter un rappel (ex: Retirer les étiquettes Stanley)"
                value={newPrinterNote}
                onChange={(e) => setNewPrinterNote(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPrinterNote()}
                style={{ flex: 1 }}
                styles={{
                  input: {
                    backgroundColor: 'var(--cream-soft)',
                    borderColor: 'var(--divider)',
                    '&:focus': { borderColor: 'var(--moss)' },
                  },
                }}
              />
              <button
                className={styles.primaryButton}
                onClick={addPrinterNote}
                disabled={saving || !newPrinterNote.trim()}
              >
                <IconPlus size={14} />
                Ajouter
              </button>
            </Group>

            {orderSettings.printer_notes.length > 0 ? (
              <Group gap="sm">
                {orderSettings.printer_notes.map((note, index) => (
                  <span key={index} className={styles.badge + ' ' + styles.badge_sand} style={{ fontSize: 12, padding: '5px 12px' }}>
                    {note}
                    <button
                      className={styles.iconButton + ' ' + styles.iconButton_danger}
                      style={{ width: 20, height: 20, marginLeft: 4, border: 'none' }}
                      onClick={() => removePrinterNote(index)}
                    >
                      <IconTrash size={12} />
                    </button>
                  </span>
                ))}
              </Group>
            ) : (
              <p className={styles.emptyStateText} style={{ fontSize: 13, minHeight: 'auto', padding: '16px 0' }}>
                Aucun rappel configuré
              </p>
            )}
          </div>
        </div>

        {/* Coût de manutention */}
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h3 className={styles.cardHeadTitle}>Coût de manutention</h3>
              <p className={styles.cardHeadSub}>
                Ce montant sera ajouté à chaque commande dans la facturation
              </p>
            </div>
          </div>
          <div className={styles.cardBody}>
            <NumberInput
              value={orderSettings.handling_fee}
              onChange={(value) => {
                const newValue = typeof value === 'string' ? parseFloat(value) || 0 : value;
                saveOrderSettings({ ...orderSettings, handling_fee: newValue });
              }}
              suffix=" € HT"
              decimalScale={2}
              fixedDecimalScale
              min={0}
              step={0.5}
              w={200}
              styles={{
                input: {
                  backgroundColor: 'var(--cream-soft)',
                  borderColor: 'var(--divider)',
                  fontFamily: 'var(--font-fraunces)',
                  fontStyle: 'normal',
                },
              }}
            />
          </div>
        </div>

        {/* Emplacements à synchroniser */}
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h3 className={styles.cardHeadTitle}>Emplacements à synchroniser</h3>
              <p className={styles.cardHeadSub}>
                Sélectionnez les emplacements dont les commandes doivent être synchronisées
              </p>
            </div>
          </div>
          <div className={styles.cardBody}>
            {locations.length > 0 ? (
              <Stack gap="xs">
                {locations.map((location) => {
                  const isSelected = orderSettings.sync_location_ids?.includes(location.id);
                  return (
                    <div
                      key={location.id}
                      className={`${styles.locationCard} ${isSelected ? styles.locationCard_active : ''}`}
                      onClick={() => toggleSyncLocation(location.id)}
                    >
                      <IconMapPin size={18} color={isSelected ? 'var(--moss)' : 'var(--slate-muted)'} />
                      <span style={{ fontWeight: isSelected ? 600 : 400, color: isSelected ? 'var(--moss)' : 'var(--slate)', fontSize: 13 }}>
                        {location.name}
                      </span>
                      {isSelected && (
                        <span className={styles.badge + ' ' + styles.badge_moss} style={{ marginLeft: 'auto' }}>
                          Sélectionné
                        </span>
                      )}
                    </div>
                  );
                })}
              </Stack>
            ) : (
              <p className={styles.emptyStateText} style={{ fontSize: 13, minHeight: 'auto', padding: '16px 0' }}>
                Aucun emplacement trouvé. Synchronisez d&apos;abord vos emplacements Shopify.
              </p>
            )}
          </div>
        </div>
      </Stack>
    </div>
  );
}
