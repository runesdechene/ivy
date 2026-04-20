'use client';

import { useState, useEffect, useCallback } from 'react';
import { Stack, TextInput, Group, Modal, Loader } from '@mantine/core';
import { IconPlus, IconTrash, IconEdit } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useDisclosure } from '@mantine/hooks';
import { useShop } from '@/context/ShopContext';
import styles from '../parametres.module.scss';

interface MetafieldConfig {
  id?: string;
  namespace: string;
  key: string;
  display_name: string;
}

export default function MetachampsPage() {
  const { currentShop } = useShop();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [metafields, setMetafields] = useState<MetafieldConfig[]>([]);
  const [editingMetafield, setEditingMetafield] = useState<MetafieldConfig | null>(null);
  const [metafieldModalOpened, { open: openMetafieldModal, close: closeMetafieldModal }] = useDisclosure(false);

  const fetchMetafields = useCallback(async () => {
    if (!currentShop) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/settings/metafields?shopId=${currentShop.id}`);
      if (response.ok) {
        const data = await response.json();
        setMetafields(data.metafields || []);
      }
    } catch (err) {
      console.error('Error fetching metafields:', err);
    } finally {
      setLoading(false);
    }
  }, [currentShop]);

  useEffect(() => {
    fetchMetafields();
  }, [fetchMetafields]);

  const saveMetafield = async (metafield: MetafieldConfig) => {
    if (!currentShop) return;

    setSaving(true);
    try {
      const response = await fetch('/api/settings/metafields', {
        method: metafield.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: metafield.id,
          shopId: currentShop.id,
          namespace: metafield.namespace,
          key: metafield.key,
          displayName: metafield.display_name,
        }),
      });

      if (response.ok) {
        notifications.show({
          title: 'Enregistré',
          message: 'Métachamp sauvegardé',
          color: 'moss',
        });
        closeMetafieldModal();
        fetchMetafields();
      } else {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Impossible de sauvegarder le métachamp';
      notifications.show({
        title: 'Erreur',
        message,
        color: 'rust',
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteMetafield = async (id: string) => {
    if (!currentShop) return;

    try {
      const response = await fetch(`/api/settings/metafields?id=${id}&shopId=${currentShop.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        notifications.show({
          title: 'Supprimé',
          message: 'Métachamp supprimé',
          color: 'moss',
        });
        fetchMetafields();
      }
    } catch (err) {
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de supprimer le métachamp',
        color: 'rust',
      });
    }
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
            <em>Métachamps</em> Shopify
          </h1>
          <div className={styles.sub}>
            Configurez les métachamps à récupérer et afficher sur les commandes
          </div>
        </div>
        <button
          className={styles.primaryButton}
          onClick={() => {
            setEditingMetafield({ namespace: '', key: '', display_name: '' });
            openMetafieldModal();
          }}
        >
          <IconPlus size={14} />
          Ajouter un métachamp
        </button>
      </div>

      <div className={styles.card}>
        {metafields.length > 0 ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Nom affiché</th>
                <th className={styles.th}>Namespace</th>
                <th className={styles.th}>Clé</th>
                <th className={styles.th} style={{ width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {metafields.map((mf) => (
                <tr key={mf.id} className={styles.tr}>
                  <td className={styles.td} style={{ fontWeight: 500 }}>{mf.display_name}</td>
                  <td className={styles.td}>
                    <span className={styles.badge + ' ' + styles.badge_plum}>{mf.namespace}</span>
                  </td>
                  <td className={styles.td}>
                    <span className={styles.badge + ' ' + styles.badge_slate}>{mf.key}</span>
                  </td>
                  <td className={styles.td}>
                    <Group gap="xs">
                      <button
                        className={styles.iconButton}
                        onClick={() => {
                          setEditingMetafield(mf);
                          openMetafieldModal();
                        }}
                      >
                        <IconEdit size={16} />
                      </button>
                      <button
                        className={`${styles.iconButton} ${styles.iconButton_danger}`}
                        onClick={() => mf.id && deleteMetafield(mf.id)}
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
              Aucun métachamp configuré. Ajoutez-en pour les afficher sur les commandes.
            </p>
          </div>
        )}
      </div>

      <Modal
        opened={metafieldModalOpened}
        onClose={closeMetafieldModal}
        title={<span className={styles.modalTitle}>{editingMetafield?.id ? 'Modifier le métachamp' : 'Ajouter un métachamp'}</span>}
        styles={{
          content: { backgroundColor: 'var(--cream-soft)' },
          header: { backgroundColor: 'var(--cream-soft)' },
        }}
      >
        {editingMetafield && (
          <Stack>
            <TextInput
              label="Nom affiché"
              description="Le nom qui sera affiché sur les commandes (ex: Recto, Verso)"
              placeholder="ex: Recto, Verso, Taille"
              value={editingMetafield.display_name}
              onChange={(e) => setEditingMetafield({ ...editingMetafield, display_name: e.target.value })}
              required
              styles={{
                input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' },
              }}
            />
            <TextInput
              label="Namespace"
              description="Le namespace du métachamp dans Shopify"
              placeholder="ex: custom, global"
              value={editingMetafield.namespace}
              onChange={(e) => setEditingMetafield({ ...editingMetafield, namespace: e.target.value })}
              required
              styles={{
                input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' },
              }}
            />
            <TextInput
              label="Clé"
              description="La clé du métachamp dans Shopify"
              placeholder="ex: fichier_d_impression, verso_impression"
              value={editingMetafield.key}
              onChange={(e) => setEditingMetafield({ ...editingMetafield, key: e.target.value })}
              required
              styles={{
                input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' },
              }}
            />
            <p style={{ fontSize: 12, color: 'var(--slate-muted)' }}>
              Le namespace et la clé correspondent aux identifiants du métachamp dans Shopify.
            </p>
            <div className={styles.modalActions}>
              <button className={styles.ghostButton} onClick={closeMetafieldModal}>Annuler</button>
              <button
                className={styles.primaryButton}
                onClick={() => saveMetafield(editingMetafield)}
                disabled={saving || !editingMetafield.namespace || !editingMetafield.key || !editingMetafield.display_name}
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
