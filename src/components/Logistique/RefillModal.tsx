'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  Modal,
  Select,
  NumberInput,
  Loader,
  Button,
  ActionIcon,
  Tooltip,
  Badge,
  SegmentedControl,
} from '@mantine/core';
import { IconMinus, IconPlus, IconExternalLink } from '@tabler/icons-react';
import {
  useRefillSuggestions,
  useSubmitRefill,
  RefillWindow,
  RefillVariant,
} from '@/hooks/useRefill';
import { RefillFillBar } from './RefillFillBar';
import { supabase } from '@/supabase/client';
import { compareSizes } from '@/utils/size-helpers';
import styles from './RefillModal.module.scss';

interface Props {
  opened: boolean;
  onClose: () => void;
  containerId: string;
  shopId: string;
}

interface DraftOrder {
  id: string;
  order_number: string;
  items_count: number;
}

interface StudyZone {
  id: string;
  name: string;
}

type VariantSort = 'color' | 'size';

function sortVariants(variants: RefillVariant[], mode: VariantSort): RefillVariant[] {
  return [...variants].sort((a, b) => {
    if (mode === 'color') {
      const colorCmp = (a.color || '').localeCompare(b.color || '');
      if (colorCmp !== 0) return colorCmp;
      return compareSizes(a.size, b.size);
    }
    const sizeCmp = compareSizes(a.size, b.size);
    if (sizeCmp !== 0) return sizeCmp;
    return (a.color || '').localeCompare(b.color || '');
  });
}

export function RefillModal({ opened, onClose, containerId, shopId }: Props) {
  const [windowParam, setWindowParam] = useState<RefillWindow>('30d');
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [variantSort, setVariantSort] = useState<VariantSort>('color');
  const [zones, setZones] = useState<StudyZone[]>([]);
  const [drafts, setDrafts] = useState<DraftOrder[]>([]);
  const [adjustedQty, setAdjustedQty] = useState<Map<string, number>>(new Map());
  const [confirmStep, setConfirmStep] = useState<null | 'pick'>(null);
  const [chosenOrderId, setChosenOrderId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<{
    orderId: string;
    orderNumber: string;
    linesAdded: number;
    linesIncremented: number;
  } | null>(null);

  const { data, isLoading, isError } = useRefillSuggestions(
    containerId,
    windowParam,
    zoneId,
    opened,
  );

  const submit = useSubmitRefill();

  useEffect(() => {
    if (!opened) return;
    let mounted = true;
    (async () => {
      const [zoneRes, ordersRes] = await Promise.all([
        supabase
          .from('pos_study_zones')
          .select('id, name')
          .eq('shop_id', shopId)
          .order('end_date', { ascending: false }),
        fetch(`/api/suppliers/orders?shopId=${shopId}`).then((r) => r.json()),
      ]);
      if (!mounted) return;
      setZones((zoneRes.data as StudyZone[]) || []);
      const allOrders = ordersRes?.orders || [];
      setDrafts(
        allOrders
          .filter((o: any) => o.status === 'draft')
          .map((o: any) => ({
            id: o.id,
            order_number: o.order_number,
            items_count: o.items_count || 0,
          })),
      );
    })();
    return () => {
      mounted = false;
    };
  }, [opened, shopId]);

  useEffect(() => {
    if (!data) return;
    const m = new Map<string, number>();
    for (const p of data.products) {
      for (const v of p.variants) {
        m.set(v.variantId, v.suggestedQty);
      }
    }
    setAdjustedQty(m);
  }, [data]);

  useEffect(() => {
    if (!opened) {
      setConfirmStep(null);
      setChosenOrderId(null);
      setSubmitError(null);
      setSubmitSuccess(null);
    }
  }, [opened]);

  const totalAdded = useMemo(
    () => Array.from(adjustedQty.values()).reduce((s, n) => s + n, 0),
    [adjustedQty],
  );
  const submitDisabled = totalAdded === 0 || submit.isPending;

  const windowShortLabel = useMemo(() => {
    if (windowParam === '7d') return '7j';
    if (windowParam === '30d') return '30j';
    if (windowParam === 'all') return 'tout';
    if (windowParam === 'zone') {
      const zone = zones.find((z) => z.id === zoneId);
      return zone?.name || 'zone';
    }
    return '';
  }, [windowParam, zoneId, zones]);

  const handleQty = (variantId: string, value: number) => {
    setAdjustedQty((prev) => {
      const m = new Map(prev);
      m.set(variantId, Math.max(0, Math.floor(value)));
      return m;
    });
  };

  const handleSubmit = async (targetOrderId?: string) => {
    if (!data) return;
    setSubmitError(null);
    const lines = Array.from(adjustedQty.entries())
      .filter(([, qty]) => qty > 0)
      .map(([variantId, quantity]) => ({ variantId, quantity }));
    try {
      const res = await submit.mutateAsync({
        containerId,
        shopId,
        orderId: targetOrderId,
        lines,
      });
      setSubmitSuccess({
        orderId: res.orderId,
        orderNumber: res.orderNumber,
        linesAdded: res.linesAdded,
        linesIncremented: res.linesIncremented,
      });
      if (res.errors?.length) {
        setSubmitError(
          `${res.errors.length} ligne(s) en échec : ${res.errors
            .map((e) => e.reason)
            .slice(0, 3)
            .join(', ')}`,
        );
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Erreur inconnue');
    }
  };

  const onClickAdd = () => {
    if (drafts.length === 0) {
      handleSubmit(undefined);
    } else {
      setChosenOrderId(drafts[0].id);
      setConfirmStep('pick');
    }
  };

  const windowOptions = [
    { value: '7d', label: '7 derniers jours' },
    { value: '30d', label: '30 derniers jours' },
    { value: 'all', label: 'Depuis toujours' },
    ...(zones.length > 0 ? [{ value: 'zone', label: "Festival (zone d'étude)" }] : []),
  ];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={data ? `Refournir ${data.containerName}` : 'Refournir'}
      size="xl"
      centered
      classNames={{ body: styles.modalBody }}
    >
      {submitSuccess && (
        <div className={styles.success}>
          <p>
            ✅ <strong>{submitSuccess.linesAdded + submitSuccess.linesIncremented}</strong>{' '}
            ligne(s) traitée(s) sur <strong>{submitSuccess.orderNumber}</strong>
            {submitSuccess.linesIncremented > 0 &&
              ` (${submitSuccess.linesIncremented} incrémentée(s))`}
          </p>
          {submitError && <p className={styles.warn}>{submitError}</p>}
          <div className={styles.successActions}>
            <Button
              component="a"
              href={`/ivy/commandes/stock/${submitSuccess.orderId}`}
              rightSection={<IconExternalLink size={14} />}
              variant="light"
            >
              Ouvrir la commande
            </Button>
            <Button onClick={onClose}>Fermer</Button>
          </div>
        </div>
      )}

      {!submitSuccess && confirmStep === 'pick' && (
        <div className={styles.pick}>
          <p>
            Une commande draft est disponible. Tu peux y ajouter les lignes ou en créer une
            nouvelle.
          </p>
          <Select
            label="Commande draft"
            data={drafts.map((d) => ({
              value: d.id,
              label: `${d.order_number} (${d.items_count} ligne${d.items_count > 1 ? 's' : ''})`,
            }))}
            value={chosenOrderId}
            onChange={setChosenOrderId}
          />
          <div className={styles.pickActions}>
            <Button variant="default" onClick={() => setConfirmStep(null)}>
              Annuler
            </Button>
            <Button
              variant="light"
              onClick={() => handleSubmit(undefined)}
              loading={submit.isPending}
            >
              Créer une nouvelle
            </Button>
            <Button
              onClick={() => chosenOrderId && handleSubmit(chosenOrderId)}
              loading={submit.isPending}
              disabled={!chosenOrderId}
            >
              Ajouter à {drafts.find((d) => d.id === chosenOrderId)?.order_number}
            </Button>
          </div>
          {submitError && <p className={styles.error}>{submitError}</p>}
        </div>
      )}

      {!submitSuccess && confirmStep === null && (
        <>
          <div className={styles.header}>
            <SegmentedControl
              size="xs"
              value={variantSort}
              onChange={(v) => setVariantSort(v as VariantSort)}
              data={[
                { label: 'Par couleur', value: 'color' },
                { label: 'Par taille', value: 'size' },
              ]}
            />
            <div className={styles.windowSelector}>
              <Select
                size="sm"
                data={windowOptions}
                value={windowParam}
                onChange={(v) => {
                  setWindowParam((v as RefillWindow) || '30d');
                  setZoneId(null);
                }}
              />
              {windowParam === 'zone' && (
                <Select
                  size="sm"
                  placeholder="Choisis une zone"
                  data={zones.map((z) => ({ value: z.id, label: z.name }))}
                  value={zoneId}
                  onChange={setZoneId}
                />
              )}
            </div>
          </div>

          {isLoading && (
            <div className={styles.empty}>
              <Loader size="sm" />
            </div>
          )}

          {isError && <div className={styles.error}>Erreur de chargement.</div>}

          {data && data.products.length === 0 && (
            <div className={styles.empty}>
              {data.window.label === 'Aucun produit affecté'
                ? "Affecte d'abord des produits à cette caisse via le menu ⋯ → Affecter des produits."
                : 'Aucune variante refournissable.'}
            </div>
          )}

          {data && data.products.length > 0 && (
            <div className={styles.body}>
              {data.products.map((p) => {
                const orderedVariants = sortVariants(p.variants, variantSort);
                return (
                <div key={p.productId} className={styles.product}>
                  <h4 className={styles.productTitle}>{p.title}</h4>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Variante</th>
                        <th>Caisse</th>
                        <th>Sorties</th>
                        <th>Quantité</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderedVariants.map((v, idx) => {
                        const qty = adjustedQty.get(v.variantId) ?? 0;
                        const muted = qty === 0;
                        const groupKey =
                          variantSort === 'color'
                            ? v.color || '—'
                            : v.size || '—';
                        const prevGroupKey =
                          idx > 0
                            ? variantSort === 'color'
                              ? orderedVariants[idx - 1].color || '—'
                              : orderedVariants[idx - 1].size || '—'
                            : null;
                        const showGroupHeader = groupKey !== prevGroupKey;
                        return (
                          <Fragment key={v.variantId}>
                            {showGroupHeader && (
                              <tr className={styles.groupSeparator}>
                                <td colSpan={4}>
                                  <span className={styles.groupLabel}>
                                    {groupKey}
                                  </span>
                                </td>
                              </tr>
                            )}
                          <tr
                            className={clsx(muted && styles.mutedRow)}
                          >
                            <td>
                              <div className={styles.variantCell}>
                                {v.colorHex && (
                                  <span
                                    className={styles.swatch}
                                    style={{ background: v.colorHex }}
                                  />
                                )}
                                <span>{v.title}</span>
                                {v.soldInWindow > 0 && (
                                  <Badge size="xs" color="teal" variant="light">
                                    {v.soldInWindow} / {windowShortLabel}
                                  </Badge>
                                )}
                                {v.sku && <span className={styles.sku}>{v.sku}</span>}
                              </div>
                            </td>
                            <td>{v.currentInBox}</td>
                            <td>{v.soldInWindow}</td>
                            <td>
                              <div className={styles.stepper}>
                                <Tooltip label="−1">
                                  <ActionIcon
                                    variant="subtle"
                                    size="sm"
                                    onClick={() => handleQty(v.variantId, qty - 1)}
                                  >
                                    <IconMinus size={12} />
                                  </ActionIcon>
                                </Tooltip>
                                <NumberInput
                                  size="xs"
                                  min={0}
                                  hideControls
                                  value={qty}
                                  onChange={(val) =>
                                    handleQty(v.variantId, typeof val === 'number' ? val : 0)
                                  }
                                  className={styles.qtyInput}
                                />
                                <Tooltip label="+1">
                                  <ActionIcon
                                    variant="subtle"
                                    size="sm"
                                    onClick={() => handleQty(v.variantId, qty + 1)}
                                  >
                                    <IconPlus size={12} />
                                  </ActionIcon>
                                </Tooltip>
                              </div>
                            </td>
                          </tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                );
              })}
            </div>
          )}

          {data && (
            <div className={styles.footer}>
              <RefillFillBar
                current={data.capacity.current}
                added={totalAdded}
                capacity={data.capacity.max}
              />
              <Button
                size="md"
                disabled={submitDisabled}
                onClick={onClickAdd}
                loading={submit.isPending}
              >
                Ajouter à une commande de stock
              </Button>
              {submitError && <p className={styles.error}>{submitError}</p>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
