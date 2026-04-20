'use client';

import { useState, useEffect, useCallback } from 'react';
import { Stack, TextInput, Group, ColorSwatch, Modal, ColorPicker, Popover, Loader } from '@mantine/core';
import { IconPlus, IconTrash, IconEdit } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useDisclosure } from '@mantine/hooks';
import { useShop } from '@/context/ShopContext';
import styles from '../parametres.module.scss';

interface ColorRule {
  id?: string;
  reception_name: string;
  display_name: string | null;
  hex_value: string;
}

export default function CouleursPage() {
  const { currentShop } = useShop();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [colorRules, setColorRules] = useState<ColorRule[]>([]);
  const [editingColor, setEditingColor] = useState<ColorRule | null>(null);
  const [colorModalOpened, { open: openColorModal, close: closeColorModal }] = useDisclosure(false);
  const [colorSearch, setColorSearch] = useState('');

  const fetchRules = useCallback(async () => {
    if (!currentShop) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/settings?shopId=${currentShop.id}`);
      if (response.ok) {
        const data = await response.json();
        setColorRules(data.colorRules || []);
      }
    } catch (err) {
      console.error('Error fetching color rules:', err);
    } finally {
      setLoading(false);
    }
  }, [currentShop]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const saveColorRule = async (rule: ColorRule) => {
    if (!currentShop) return;

    setSaving(true);
    try {
      const response = await fetch('/api/settings/colors', {
        method: rule.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...rule,
          shopId: currentShop.id,
        }),
      });

      if (response.ok) {
        notifications.show({
          title: 'Enregistré',
          message: 'Règle de couleur sauvegardée',
          color: 'moss',
        });
        closeColorModal();
        fetchRules();
      } else {
        throw new Error('Failed to save');
      }
    } catch (err) {
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de sauvegarder la règle',
        color: 'rust',
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteColorRule = async (id: string) => {
    if (!currentShop) return;

    try {
      const response = await fetch(`/api/settings/colors?id=${id}&shopId=${currentShop.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        notifications.show({
          title: 'Supprimé',
          message: 'Règle supprimée',
          color: 'moss',
        });
        fetchRules();
      }
    } catch (err) {
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de supprimer la règle',
        color: 'rust',
      });
    }
  };

  const shopName = currentShop?.name || 'Runes de Chêne';

  const filteredRules = colorRules.filter(rule =>
    colorSearch === '' ||
    rule.reception_name.toLowerCase().includes(colorSearch.toLowerCase()) ||
    (rule.display_name && rule.display_name.toLowerCase().includes(colorSearch.toLowerCase()))
  );

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
            Mapping des <em>couleurs</em>
          </h1>
          <div className={styles.sub}>
            Définissez comment les noms de couleurs Shopify sont affichés dans Ivy
          </div>
        </div>
        <button
          className={styles.primaryButton}
          onClick={() => {
            setEditingColor({ reception_name: '', display_name: null, hex_value: '#808080' });
            openColorModal();
          }}
        >
          <IconPlus size={14} />
          Ajouter une couleur
        </button>
      </div>

      <div className={styles.card}>
        {colorRules.length > 0 && (
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--divider)' }}>
            <TextInput
              placeholder="Rechercher une couleur..."
              value={colorSearch}
              onChange={(e) => setColorSearch(e.target.value)}
              styles={{
                input: {
                  backgroundColor: 'var(--cream-soft)',
                  borderColor: 'var(--divider)',
                },
              }}
            />
          </div>
        )}

        {colorRules.length > 0 ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th} style={{ width: 60 }}>Couleur</th>
                <th className={styles.th}>Nom de réception</th>
                <th className={styles.th}>Nom sur Ivy</th>
                <th className={styles.th} style={{ width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRules.map((rule) => (
                <tr key={rule.id || rule.reception_name} className={styles.tr}>
                  <td className={styles.td}>
                    <ColorSwatch color={rule.hex_value} size={24} />
                  </td>
                  <td className={styles.td}>{rule.reception_name}</td>
                  <td className={styles.td}>
                    {rule.display_name ? (
                      <span className={styles.badge + ' ' + styles.badge_plum}>{rule.display_name}</span>
                    ) : (
                      <span style={{ color: 'var(--slate-muted)' }}>&mdash;</span>
                    )}
                  </td>
                  <td className={styles.td}>
                    <Group gap="xs">
                      <button
                        className={styles.iconButton}
                        onClick={() => {
                          setEditingColor(rule);
                          openColorModal();
                        }}
                      >
                        <IconEdit size={16} />
                      </button>
                      <button
                        className={`${styles.iconButton} ${styles.iconButton_danger}`}
                        onClick={() => rule.id && deleteColorRule(rule.id)}
                      >
                        <IconTrash size={16} />
                      </button>
                    </Group>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className={styles.cardBody}>
            <p className={styles.emptyStateText}>
              Aucune règle de couleur définie.
            </p>
          </div>
        )}
      </div>

      <Modal
        opened={colorModalOpened}
        onClose={closeColorModal}
        title={<span className={styles.modalTitle}>{editingColor?.id ? 'Modifier la couleur' : 'Ajouter une couleur'}</span>}
        styles={{
          content: { backgroundColor: 'var(--cream-soft)' },
          header: { backgroundColor: 'var(--cream-soft)' },
        }}
      >
        {editingColor && (
          <Stack>
            <TextInput
              label="Nom de réception"
              description="Le nom de la couleur tel qu'il arrive de Shopify (ex: Bleu Marine)"
              placeholder="ex: Bleu Marine, Rouge Bordeaux"
              value={editingColor.reception_name}
              onChange={(e) => setEditingColor({ ...editingColor, reception_name: e.target.value })}
              required
              styles={{
                input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' },
              }}
            />
            <TextInput
              label="Nom sur Ivy"
              description="Le nom à afficher dans l'application (laisser vide pour garder le nom de réception)"
              placeholder="ex: French Navy, Burgundy"
              value={editingColor.display_name || ''}
              onChange={(e) => setEditingColor({ ...editingColor, display_name: e.target.value || null })}
              styles={{
                input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' },
              }}
            />
            <div>
              <label style={{ fontSize: 14, fontWeight: 500, color: 'var(--slate)', display: 'block', marginBottom: 4 }}>
                Couleur associée
              </label>
              <p style={{ fontSize: 12, color: 'var(--slate-muted)', marginBottom: 8 }}>
                Code hexadécimal pour l&apos;affichage visuel
              </p>
              <Group align="flex-start">
                <TextInput
                  placeholder="#FF0000"
                  value={editingColor.hex_value}
                  onChange={(e) => setEditingColor({ ...editingColor, hex_value: e.target.value })}
                  style={{ flex: 1 }}
                  styles={{
                    input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' },
                  }}
                />
                <Popover position="bottom" withArrow shadow="md">
                  <Popover.Target>
                    <button
                      className={styles.iconButton}
                      style={{
                        backgroundColor: editingColor.hex_value,
                        border: '2px solid var(--divider-strong)',
                        width: 36,
                        height: 36,
                      }}
                    >
                      <span />
                    </button>
                  </Popover.Target>
                  <Popover.Dropdown>
                    <ColorPicker
                      format="hex"
                      value={editingColor.hex_value}
                      onChange={(color) => setEditingColor({ ...editingColor, hex_value: color })}
                      swatches={[
                        '#ffffff', '#f8f9fa', '#e9ecef', '#dee2e6', '#ced4da', '#adb5bd', '#868e96', '#495057', '#343a40', '#212529',
                        '#000000', '#c92a2a', '#a61e4d', '#862e9c', '#5f3dc4', '#364fc7', '#1864ab', '#0b7285', '#087f5b', '#2b8a3e',
                        '#5c940d', '#e67700', '#d9480f', '#f03e3e', '#d6336c', '#ae3ec9', '#7048e8', '#4263eb', '#1c7ed6', '#15aabf',
                        '#12b886', '#40c057', '#82c91e', '#fab005', '#fd7e14', '#ff6b6b', '#f06595', '#cc5de8', '#845ef7', '#5c7cfa',
                        '#339af0', '#22b8cf', '#20c997', '#51cf66', '#94d82d', '#fcc419', '#ff922b',
                      ]}
                    />
                  </Popover.Dropdown>
                </Popover>
              </Group>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.ghostButton} onClick={closeColorModal}>Annuler</button>
              <button
                className={styles.primaryButton}
                onClick={() => saveColorRule(editingColor)}
                disabled={saving || !editingColor.reception_name.trim()}
              >
                Sauvegarder
              </button>
            </div>
          </Stack>
        )}
      </Modal>
    </div>
  );
}
