'use client';

import { useState } from 'react';
import { Modal, Tabs, Stack, Select, TextInput, NumberInput, Group } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  type ContainerType,
  useCreateContainerType,
} from '@/hooks/useContainerTypes';
import { useCreateContainer } from '@/hooks/useContainers';

interface Props {
  opened: boolean;
  onClose: () => void;
  shopId: string;
  locationId: string;
  existingTypes: ContainerType[];
}

const inputStyles = {
  input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' },
};

export function AddContainerModal({ opened, onClose, shopId, locationId, existingTypes }: Props) {
  const [tab, setTab] = useState<string | null>('existing');
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const createInstance = useCreateContainer();
  const createType = useCreateContainerType();

  const [form, setForm] = useState({
    name: '',
    max_capacity: 70,
    empty_weight_g: null as number | null,
    ratio_w: 1,
    ratio_h: 1,
    columns: 1,
  });

  const reset = () => {
    setSelectedTypeId(null);
    setForm({ name: '', max_capacity: 70, empty_weight_g: null, ratio_w: 1, ratio_h: 1, columns: 1 });
    setTab('existing');
  };

  const close = () => {
    reset();
    onClose();
  };

  const addExisting = async () => {
    if (!selectedTypeId) return;
    try {
      await createInstance.mutateAsync({
        shop_id: shopId,
        container_type_id: selectedTypeId,
        location_id: locationId,
      });
      notifications.show({ title: 'Conteneur ajouté', message: '', color: 'moss' });
      close();
    } catch (e) {
      notifications.show({ title: 'Erreur', message: (e as Error).message, color: 'rust' });
    }
  };

  const createAndAdd = async () => {
    if (!form.name) return;
    try {
      const newType = await createType.mutateAsync({ shop_id: shopId, ...form });
      await createInstance.mutateAsync({
        shop_id: shopId,
        container_type_id: newType.id,
        location_id: locationId,
      });
      notifications.show({ title: 'Type créé + ajouté ici', message: form.name, color: 'moss' });
      close();
    } catch (e) {
      notifications.show({ title: 'Erreur', message: (e as Error).message, color: 'rust' });
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={close}
      title="Ajouter un conteneur"
      centered
      size="md"
      styles={{
        content: { backgroundColor: 'var(--cream-soft)' },
        header: { backgroundColor: 'var(--cream-soft)' },
      }}
    >
      <Tabs value={tab} onChange={setTab}>
        <Tabs.List>
          <Tabs.Tab value="existing">Choisir un type</Tabs.Tab>
          <Tabs.Tab value="new">Créer un type</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="existing" pt="md">
          <Stack>
            <Select
              label="Type de conteneur"
              data={existingTypes.map((t) => ({
                value: t.id,
                label: `${t.name} (cap. ${t.max_capacity})`,
              }))}
              value={selectedTypeId}
              onChange={setSelectedTypeId}
              placeholder="Sélectionner…"
              searchable
              nothingFoundMessage="Aucun type. Crée-en un dans l'autre onglet."
              styles={inputStyles}
            />
            <Group justify="flex-end" mt="xs">
              <button
                type="button"
                onClick={close}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--divider)',
                  borderRadius: 6,
                  padding: '6px 14px',
                  cursor: 'pointer',
                }}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={addExisting}
                disabled={!selectedTypeId || createInstance.isPending}
                style={{
                  background: 'var(--moss)',
                  color: 'var(--cream)',
                  border: '1px solid var(--moss)',
                  borderRadius: 6,
                  padding: '6px 14px',
                  cursor: selectedTypeId ? 'pointer' : 'not-allowed',
                  opacity: selectedTypeId ? 1 : 0.5,
                }}
              >
                Ajouter ici
              </button>
            </Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="new" pt="md">
          <Stack>
            <TextInput
              label="Nom"
              placeholder="ex: Caisse Tshirt"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
              required
              styles={inputStyles}
            />
            <NumberInput
              label="Capacité max"
              value={form.max_capacity}
              onChange={(v) => setForm({ ...form, max_capacity: typeof v === 'number' ? v : 1 })}
              min={1}
              required
              styles={inputStyles}
            />
            <NumberInput
              label="Poids à vide (g, optionnel)"
              value={form.empty_weight_g ?? ''}
              onChange={(v) => setForm({ ...form, empty_weight_g: typeof v === 'number' ? v : null })}
              min={0}
              styles={inputStyles}
            />
            <Group grow>
              <NumberInput
                label="Ratio W"
                value={form.ratio_w}
                onChange={(v) => setForm({ ...form, ratio_w: typeof v === 'number' ? v : 1 })}
                min={1}
                max={5}
                styles={inputStyles}
              />
              <NumberInput
                label="Ratio H"
                value={form.ratio_h}
                onChange={(v) => setForm({ ...form, ratio_h: typeof v === 'number' ? v : 1 })}
                min={1}
                max={5}
                styles={inputStyles}
              />
              <NumberInput
                label="Compartiments"
                value={form.columns}
                onChange={(v) => setForm({ ...form, columns: typeof v === 'number' ? v : 1 })}
                min={1}
                max={8}
                styles={inputStyles}
              />
            </Group>
            <Group justify="flex-end" mt="xs">
              <button
                type="button"
                onClick={close}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--divider)',
                  borderRadius: 6,
                  padding: '6px 14px',
                  cursor: 'pointer',
                }}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={createAndAdd}
                disabled={!form.name || createType.isPending || createInstance.isPending}
                style={{
                  background: 'var(--moss)',
                  color: 'var(--cream)',
                  border: '1px solid var(--moss)',
                  borderRadius: 6,
                  padding: '6px 14px',
                  cursor: form.name ? 'pointer' : 'not-allowed',
                  opacity: form.name ? 1 : 0.5,
                }}
              >
                Créer + ajouter
              </button>
            </Group>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}
