'use client';

import { useEffect, useState } from 'react';
import { Modal, MultiSelect, Stack, Group } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  type ContainerInstance,
  useSetContainerProducts,
  useShopProducts,
} from '@/hooks/useContainers';

interface Props {
  opened: boolean;
  onClose: () => void;
  instance: ContainerInstance;
  shopId: string;
}

export function AssignProductsModal({ opened, onClose, instance, shopId }: Props) {
  const { data: products = [], isLoading } = useShopProducts(shopId);
  const setProducts = useSetContainerProducts();
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (opened) {
      setSelected(instance.products.map((p) => p.id));
    }
  }, [opened, instance.products]);

  const submit = async () => {
    try {
      await setProducts.mutateAsync({ id: instance.id, productIds: selected });
      notifications.show({ title: 'Affectation mise à jour', message: '', color: 'moss' });
      onClose();
    } catch (e) {
      notifications.show({ title: 'Erreur', message: (e as Error).message, color: 'rust' });
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`Affecter — ${instance.type.name}`}
      centered
      styles={{
        content: { backgroundColor: 'var(--cream-soft)' },
        header: { backgroundColor: 'var(--cream-soft)' },
      }}
    >
      <Stack>
        <MultiSelect
          label="Produits"
          placeholder={isLoading ? 'Chargement…' : 'Choisir un ou plusieurs produits'}
          data={products.map((p) => ({ value: p.id, label: p.title }))}
          value={selected}
          onChange={setSelected}
          searchable
          nothingFoundMessage="Aucun produit"
          styles={{ input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' } }}
        />
        <Group justify="flex-end">
          <button
            type="button"
            onClick={onClose}
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
            onClick={submit}
            disabled={setProducts.isPending}
            style={{
              background: 'var(--moss)',
              color: 'var(--cream)',
              border: '1px solid var(--moss)',
              borderRadius: 6,
              padding: '6px 14px',
              cursor: 'pointer',
            }}
          >
            Enregistrer
          </button>
        </Group>
      </Stack>
    </Modal>
  );
}
