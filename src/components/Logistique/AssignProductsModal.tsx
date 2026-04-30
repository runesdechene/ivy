'use client';

import { useEffect, useState } from 'react';
import { Modal, MultiSelect, Stack, Group, SegmentedControl, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  type ContainerInstance,
  useSetContainerProducts,
  useSetContainerFilters,
  useShopProducts,
  useProductTypes,
} from '@/hooks/useContainers';

interface Props {
  opened: boolean;
  onClose: () => void;
  instance: ContainerInstance;
  shopId: string;
}

const STANDARD_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];

type Mode = 'product' | 'filter';

export function AssignProductsModal({ opened, onClose, instance, shopId }: Props) {
  const { data: products = [], isLoading: productsLoading } = useShopProducts(shopId);
  const { data: types = [], isLoading: typesLoading } = useProductTypes(shopId);
  const setProducts = useSetContainerProducts();
  const setFilters = useSetContainerFilters();

  const [mode, setMode] = useState<Mode>('product');
  const [selected, setSelected] = useState<string[]>([]);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [filterSizes, setFilterSizes] = useState<string[]>([]);

  useEffect(() => {
    if (!opened) return;
    const hasTypes = !!instance.filter_product_type && instance.filter_product_type.length > 0;
    const hasSizes = !!instance.filter_size && instance.filter_size.length > 0;
    setMode(hasTypes || hasSizes ? 'filter' : 'product');
    setSelected(instance.products.map((p) => p.id));
    setFilterTypes(instance.filter_product_type ?? []);
    setFilterSizes(instance.filter_size ?? []);
  }, [opened, instance]);

  const submit = async () => {
    try {
      if (mode === 'product') {
        // Sortir du mode filtre si on était dedans, puis poser les produits
        const wasFilter =
          (instance.filter_product_type?.length ?? 0) > 0 ||
          (instance.filter_size?.length ?? 0) > 0;
        if (wasFilter) {
          await setFilters.mutateAsync({
            id: instance.id,
            filter_product_type: null,
            filter_size: null,
          });
        }
        await setProducts.mutateAsync({ id: instance.id, productIds: selected });
      } else {
        if (filterTypes.length === 0 && filterSizes.length === 0) {
          notifications.show({
            title: 'Filtre vide',
            message: 'Choisis au moins un type ou une taille.',
            color: 'rust',
          });
          return;
        }
        // Vider les produits explicites pour éviter la confusion (le mode
        // filtre ne les utilise plus mais les rows resteraient en base sinon)
        await setProducts.mutateAsync({ id: instance.id, productIds: [] });
        await setFilters.mutateAsync({
          id: instance.id,
          filter_product_type: filterTypes.length > 0 ? filterTypes : null,
          filter_size: filterSizes.length > 0 ? filterSizes : null,
        });
      }
      notifications.show({ title: 'Affectation mise à jour', message: '', color: 'moss' });
      onClose();
    } catch (e) {
      notifications.show({ title: 'Erreur', message: (e as Error).message, color: 'rust' });
    }
  };

  const isPending = setProducts.isPending || setFilters.isPending;

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
        <SegmentedControl
          value={mode}
          onChange={(v) => setMode(v as Mode)}
          data={[
            { label: 'Par produit', value: 'product' },
            { label: 'Par filtre', value: 'filter' },
          ]}
          fullWidth
        />

        {mode === 'product' ? (
          <MultiSelect
            label="Produits"
            placeholder={productsLoading ? 'Chargement…' : 'Choisir un ou plusieurs produits'}
            data={products.map((p) => ({ value: p.id, label: p.title }))}
            value={selected}
            onChange={setSelected}
            searchable
            nothingFoundMessage="Aucun produit"
            styles={{ input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' } }}
          />
        ) : (
          <Stack gap="xs">
            <Text size="xs" c="dimmed">
              La caisse collectera automatiquement toutes les variantes qui matchent.
              Plusieurs valeurs sont combinées en OU. Au moins un des deux champs doit
              être renseigné.
            </Text>
            <MultiSelect
              label="Types de produit"
              placeholder={typesLoading ? 'Chargement…' : 'Tous les types'}
              data={types.map((t) => ({ value: t, label: t }))}
              value={filterTypes}
              onChange={setFilterTypes}
              searchable
              clearable
              nothingFoundMessage="Aucun type"
              styles={{ input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' } }}
            />
            <MultiSelect
              label="Tailles"
              placeholder="Toutes les tailles"
              data={STANDARD_SIZES.map((s) => ({ value: s, label: s }))}
              value={filterSizes}
              onChange={setFilterSizes}
              clearable
              styles={{ input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' } }}
            />
          </Stack>
        )}

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
            disabled={isPending}
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
