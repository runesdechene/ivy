'use client';

import { useState } from 'react';
import { Stack, TextInput, NumberInput, Group, Modal, Loader } from '@mantine/core';
import { IconPlus, IconTrash, IconEdit } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useDisclosure } from '@mantine/hooks';
import { useShop } from '@/context/ShopContext';
import {
  useContainerTypes,
  useCreateContainerType,
  useUpdateContainerType,
  useDeleteContainerType,
  type ContainerType,
} from '@/hooks/useContainerTypes';
import styles from '../parametres.module.scss';

type FormState = {
  name: string;
  max_capacity: number;
  empty_weight_g: number | null;
  ratio_w: number;
  ratio_h: number;
  columns: number;
};

const EMPTY: FormState = { name: '', max_capacity: 70, empty_weight_g: null, ratio_w: 1, ratio_h: 1, columns: 1 };

export default function ConteneursPage() {
  const { currentShop } = useShop();
  const { data: types = [], isLoading } = useContainerTypes(currentShop?.id);
  const createMut = useCreateContainerType();
  const updateMut = useUpdateContainerType();
  const deleteMut = useDeleteContainerType();

  const [editing, setEditing] = useState<ContainerType | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  const shopName = currentShop?.name || 'Runes de Chêne';

  const openForCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    openModal();
  };

  const openForEdit = (t: ContainerType) => {
    setEditing(t);
    setForm({
      name: t.name,
      max_capacity: t.max_capacity,
      empty_weight_g: t.empty_weight_g,
      ratio_w: t.ratio_w,
      ratio_h: t.ratio_h,
      columns: t.columns ?? 1,
    });
    openModal();
  };

  const submit = async () => {
    if (!currentShop || !form.name) return;
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, ...form });
        notifications.show({ title: 'Mis à jour', message: form.name, color: 'moss' });
      } else {
        await createMut.mutateAsync({ shop_id: currentShop.id, ...form });
        notifications.show({ title: 'Créé', message: form.name, color: 'moss' });
      }
      closeModal();
    } catch (e) {
      notifications.show({ title: 'Erreur', message: (e as Error).message, color: 'rust' });
    }
  };

  const remove = async (t: ContainerType) => {
    if (!confirm(`Supprimer le type « ${t.name} » ?`)) return;
    try {
      await deleteMut.mutateAsync(t.id);
      notifications.show({ title: 'Supprimé', message: t.name, color: 'moss' });
    } catch (e) {
      notifications.show({ title: 'Erreur', message: (e as Error).message, color: 'rust' });
    }
  };

  if (isLoading) {
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
            Types de <em>conteneurs</em>
          </h1>
          <div className={styles.sub}>
            Définis les caisses physiques disponibles dans tes emplacements (capacité, poids, ratio visuel).
          </div>
        </div>
        <button className={styles.primaryButton} onClick={openForCreate}>
          <IconPlus size={14} />
          Nouveau type
        </button>
      </div>

      <div className={styles.card}>
        {types.length > 0 ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th} style={{ width: 80 }}>Forme</th>
                <th className={styles.th}>Nom</th>
                <th className={styles.th} style={{ width: 120 }}>Capacité</th>
                <th className={styles.th} style={{ width: 140 }}>Poids vide</th>
                <th className={styles.th} style={{ width: 100 }}>Ratio</th>
                <th className={styles.th} style={{ width: 100 }}>Colonnes</th>
                <th className={styles.th} style={{ width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} className={styles.tr}>
                  <td className={styles.td}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 16 * t.ratio_w,
                        height: 16 * t.ratio_h,
                        background: 'var(--moss-soft, #c9d4b6)',
                        border: '1px solid var(--divider, #e0d8c8)',
                        borderRadius: 3,
                      }}
                      aria-label={`${t.ratio_w}×${t.ratio_h}`}
                    />
                  </td>
                  <td className={styles.td} style={{ fontWeight: 500 }}>{t.name}</td>
                  <td className={styles.td}>{t.max_capacity} unités</td>
                  <td className={styles.td}>{t.empty_weight_g != null ? `${t.empty_weight_g} g` : '—'}</td>
                  <td className={styles.td}>{t.ratio_w}×{t.ratio_h}</td>
                  <td className={styles.td}>{t.columns ?? 1}</td>
                  <td className={styles.td}>
                    <Group gap="xs">
                      <button className={styles.iconButton} onClick={() => openForEdit(t)}>
                        <IconEdit size={16} />
                      </button>
                      <button
                        className={`${styles.iconButton} ${styles.iconButton_danger}`}
                        onClick={() => remove(t)}
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
              Aucun type de conteneur. Crée ta première caisse.
            </p>
          </div>
        )}
      </div>

      <Modal
        opened={modalOpened}
        onClose={closeModal}
        title={
          <span className={styles.modalTitle}>
            {editing ? 'Modifier le type' : 'Nouveau type'}
          </span>
        }
        styles={{
          content: { backgroundColor: 'var(--cream-soft)' },
          header: { backgroundColor: 'var(--cream-soft)' },
        }}
      >
        <Stack>
          <TextInput
            label="Nom"
            placeholder="ex: Caisse Tshirt classique"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
            required
            styles={{ input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' } }}
          />
          <NumberInput
            label="Capacité max (unités)"
            value={form.max_capacity}
            onChange={(v) => setForm({ ...form, max_capacity: typeof v === 'number' ? v : 1 })}
            min={1}
            required
            styles={{ input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' } }}
          />
          <NumberInput
            label="Poids à vide (g, optionnel)"
            value={form.empty_weight_g ?? ''}
            onChange={(v) => setForm({ ...form, empty_weight_g: typeof v === 'number' ? v : null })}
            min={0}
            styles={{ input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' } }}
          />
          <Group grow>
            <NumberInput
              label="Ratio largeur"
              value={form.ratio_w}
              onChange={(v) => setForm({ ...form, ratio_w: typeof v === 'number' ? v : 1 })}
              min={1}
              max={5}
              styles={{ input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' } }}
            />
            <NumberInput
              label="Ratio hauteur"
              value={form.ratio_h}
              onChange={(v) => setForm({ ...form, ratio_h: typeof v === 'number' ? v : 1 })}
              min={1}
              max={5}
              styles={{ input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' } }}
            />
            <NumberInput
              label="Compartiments"
              description="Divisions visuelles (1-3)"
              value={form.columns}
              onChange={(v) => setForm({ ...form, columns: typeof v === 'number' ? v : 1 })}
              min={1}
              max={5}
              styles={{ input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' } }}
            />
          </Group>
          <Group justify="flex-end" mt="md">
            <button className={styles.ghostButton} onClick={closeModal}>Annuler</button>
            <button
              className={styles.primaryButton}
              onClick={submit}
              disabled={createMut.isPending || updateMut.isPending || !form.name}
            >
              {editing ? 'Enregistrer' : 'Créer'}
            </button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
