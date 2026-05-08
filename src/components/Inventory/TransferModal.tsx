'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal, Select, NumberInput, Button, Group, Stack, Text, Loader } from '@mantine/core';
import { IconArrowsExchange } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useLocation } from '@/context/LocationContext';
import type { ProductData } from './ProductCard';
import styles from './TransferModal.module.scss';

interface TransferModalProps {
  opened: boolean;
  onClose: () => void;
  product: ProductData;
  selectedVariantIds: Set<string>;
  shopId: string | undefined;
  sourceLocationId: string | undefined;
  sourceLocationName: string | undefined;
  onSuccess: (transferred: { variantId: string; quantity: number }[]) => void;
}

export function TransferModal({
  opened,
  onClose,
  product,
  selectedVariantIds,
  shopId,
  sourceLocationId,
  sourceLocationName,
  onSuccess,
}: TransferModalProps) {
  const { locations } = useLocation();
  const [destLocationId, setDestLocationId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  const selectedVariants = useMemo(
    () => product.variants.filter((v) => selectedVariantIds.has(v.id)),
    [product.variants, selectedVariantIds],
  );

  useEffect(() => {
    if (opened) {
      const initial: Record<string, number> = {};
      for (const v of selectedVariants) {
        initial[v.id] = Math.max(0, v.quantity);
      }
      setQuantities(initial);
      setDestLocationId(null);
    }
  }, [opened, selectedVariants]);

  const destOptions = useMemo(
    () =>
      locations
        .filter((loc) => loc.id !== sourceLocationId)
        .map((loc) => ({ value: loc.id, label: loc.name })),
    [locations, sourceLocationId],
  );

  const totalToTransfer = useMemo(
    () => Object.values(quantities).reduce((sum, q) => sum + q, 0),
    [quantities],
  );

  const destLocationName = useMemo(
    () => locations.find((loc) => loc.id === destLocationId)?.name ?? '',
    [locations, destLocationId],
  );

  const handleQuantityChange = (variantId: string, value: number, max: number) => {
    setQuantities((prev) => ({
      ...prev,
      [variantId]: Math.max(0, Math.min(max, value)),
    }));
  };

  const handleSubmit = async () => {
    if (!shopId || !sourceLocationId || !destLocationId) return;

    const items = selectedVariants
      .filter((v) => (quantities[v.id] ?? 0) > 0)
      .map((v) => ({
        variantId: v.id,
        quantity: quantities[v.id],
        productTitle: product.title,
        variantTitle: v.title ?? undefined,
      }));

    if (items.length === 0) {
      notifications.show({
        title: 'Aucune variante à transférer',
        message: 'Toutes les quantités sont à zéro',
        color: 'clay',
      });
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/inventory/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, sourceLocationId, destLocationId, items }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? 'Erreur de transfert');
      }

      const successResults: { variantId: string; success: boolean; error?: string }[] = data.results ?? [];
      const successfulVariantIds = new Set(
        successResults.filter((r) => r.success).map((r) => r.variantId),
      );
      const transferred = items
        .filter((it) => successfulVariantIds.has(it.variantId))
        .map((it) => ({ variantId: it.variantId, quantity: it.quantity }));

      const failedCount = items.length - transferred.length;

      if (failedCount === 0) {
        notifications.show({
          title: 'Transfert réussi',
          message: `${totalToTransfer} unité(s) de ${transferred.length} variante(s) transférée(s) vers ${destLocationName}`,
          color: 'moss',
        });
      } else if (transferred.length === 0) {
        const firstError = successResults.find((r) => !r.success)?.error ?? 'Erreur inconnue';
        notifications.show({
          title: 'Transfert échoué',
          message: firstError,
          color: 'rust',
        });
      } else {
        notifications.show({
          title: 'Transfert partiel',
          message: `${transferred.length}/${items.length} variante(s) transférée(s) — ${failedCount} échec(s)`,
          color: 'clay',
        });
      }

      onSuccess(transferred);
      if (failedCount === 0) {
        onClose();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Une erreur est survenue';
      notifications.show({ title: 'Erreur', message, color: 'rust' });
    } finally {
      setSubmitting(false);
    }
  };

  const submitLabel = destLocationId
    ? `Transférer ${totalToTransfer} unité${totalToTransfer > 1 ? 's' : ''} vers ${destLocationName}`
    : 'Choisir une destination';

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      radius="lg"
      size="lg"
      centered
      title={
        <span className={styles.modalTitle}>
          <IconArrowsExchange size={18} />
          Transférer le stock
        </span>
      }
    >
      <Stack gap="md">
        <Text size="sm" c="slate.7">
          Depuis <Text span fw={600}>{sourceLocationName ?? '—'}</Text>
        </Text>

        <Select
          label="Vers l'emplacement"
          placeholder="Choisir une destination"
          data={destOptions}
          value={destLocationId}
          onChange={setDestLocationId}
          searchable
          nothingFoundMessage="Aucun autre emplacement"
          disabled={submitting}
        />

        <table className={styles.variantTable}>
          <thead>
            <tr>
              <th>Variante</th>
              <th>Dispo</th>
              <th style={{ textAlign: 'right' }}>Qty à transférer</th>
            </tr>
          </thead>
          <tbody>
            {selectedVariants.map((v) => {
              const dispo = Math.max(0, v.quantity);
              return (
                <tr key={v.id}>
                  <td>{v.title ?? '—'}</td>
                  <td>{dispo}</td>
                  <td className={styles.qtyCell}>
                    <NumberInput
                      value={quantities[v.id] ?? 0}
                      onChange={(val) =>
                        handleQuantityChange(v.id, typeof val === 'number' ? val : 0, dispo)
                      }
                      min={0}
                      max={dispo}
                      hideControls
                      disabled={submitting || dispo === 0}
                      styles={{ input: { width: 80, textAlign: 'right' } }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className={styles.totalLine}>
          <span>Total</span>
          <span>{totalToTransfer} unité{totalToTransfer > 1 ? 's' : ''}</span>
        </div>

        <Group justify="flex-end" gap="sm" mt="md">
          <Button variant="default" color="slate" onClick={onClose} disabled={submitting}>
            Annuler
          </Button>
          <Button
            color="moss"
            leftSection={submitting ? <Loader size={14} color="white" /> : <IconArrowsExchange size={16} />}
            onClick={handleSubmit}
            disabled={!destLocationId || totalToTransfer === 0 || submitting}
          >
            {submitting ? 'Transfert…' : submitLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
