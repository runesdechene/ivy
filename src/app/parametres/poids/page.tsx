'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { NumberInput, Select, Checkbox, Loader, Tooltip } from '@mantine/core';
import { IconFlag } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useShop } from '@/context/ShopContext';
import { SIZE_LADDER, computeWeight, sizeDistance, type SizeLabel } from '@/lib/weights/sizes';
import styles from '../parametres.module.scss';

interface WeightRule {
  id?: string;
  product_type: string;
  reference_size: string;
  reference_grams: number;
  step_pct: number;
}

interface UnweightedVariant {
  id: string;
  sku: string | null;
  title: string | null;
  productType: string;
}

interface ApplyResult {
  filled: number;
  pushed: number;
  localOnly: number;
  unresolved: number;
  failures: { variantId: string; sku: string | null; error: string }[];
}

interface RowState {
  productType: string;
  sizes: SizeLabel[];
  ruleId?: string;
  referenceSize: string;
  referenceGrams: number | '';
  stepPct: number | '';
  overwrite: boolean;
  cellValues: Record<string, number | ''>;
  applying: boolean;
}

function computeRowCells(
  sizes: SizeLabel[],
  referenceSize: string,
  referenceGrams: number | '',
  stepPct: number | ''
): Record<string, number | ''> {
  const result: Record<string, number | ''> = {};
  for (const size of sizes) {
    if (size === referenceSize) continue;
    if (typeof referenceGrams !== 'number' || typeof stepPct !== 'number') {
      result[size] = '';
      continue;
    }
    const distance = sizeDistance(referenceSize, size);
    result[size] = distance === null ? '' : computeWeight(referenceGrams, stepPct, distance);
  }
  return result;
}

function buildRow(
  productType: string,
  sizes: SizeLabel[],
  rule: WeightRule | undefined
): RowState {
  const referenceSize = rule?.reference_size || (sizes.includes('M') ? 'M' : sizes[0] || '');
  const referenceGrams = rule?.reference_grams ?? '';
  const stepPct = rule?.step_pct ?? 8;

  return {
    productType,
    sizes,
    ruleId: rule?.id,
    referenceSize,
    referenceGrams,
    stepPct,
    overwrite: false,
    cellValues: computeRowCells(sizes, referenceSize, referenceGrams, stepPct),
    applying: false,
  };
}

export default function PoidsPage() {
  const { currentShop } = useShop();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RowState[]>([]);
  const [unweighted, setUnweighted] = useState<UnweightedVariant[]>([]);
  const [unweightedTotal, setUnweightedTotal] = useState(0);
  const [unitDrafts, setUnitDrafts] = useState<Record<string, number | ''>>({});
  const [unitSaving, setUnitSaving] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async () => {
    if (!currentShop) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/settings/weight-rules?shopId=${currentShop.id}`);
      if (response.ok) {
        const data = await response.json();
        const rules: WeightRule[] = data.rules || [];
        const productTypes: string[] = data.productTypes || [];
        const sizesByType: Record<string, SizeLabel[]> = data.sizesByType || {};

        const ruleByType = new Map(rules.map((r) => [r.product_type, r]));
        setRows(
          productTypes.map((pt) => buildRow(pt, sizesByType[pt] || [], ruleByType.get(pt)))
        );
        setUnweighted(data.unweighted || []);
        setUnweightedTotal(data.unweightedTotal || 0);
      }
    } catch (err) {
      console.error('Error fetching weight rules:', err);
    } finally {
      setLoading(false);
    }
  }, [currentShop]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Colonnes de la grille = union des tailles présentes sur tous les types de produit,
  // ordonnées selon l'échelle.
  const columns = useMemo(() => {
    const present = new Set<string>();
    for (const row of rows) {
      for (const s of row.sizes) present.add(s);
    }
    return SIZE_LADDER.filter((s) => present.has(s));
  }, [rows]);

  const patchRow = (productType: string, patch: Partial<RowState>) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.productType !== productType) return r;
        const updated = { ...r, ...patch };
        updated.cellValues = computeRowCells(
          updated.sizes,
          updated.referenceSize,
          updated.referenceGrams,
          updated.stepPct
        );
        return updated;
      })
    );
  };

  const handleCellChange = (productType: string, size: string, value: number | '') => {
    setRows((prev) =>
      prev.map((r) =>
        r.productType === productType
          ? { ...r, cellValues: { ...r.cellValues, [size]: value } }
          : r
      )
    );
  };

  const handlePromote = (productType: string, size: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.productType !== productType) return r;
        const value = r.cellValues[size];
        if (typeof value !== 'number' || value <= 0) return r;
        const updated: RowState = { ...r, referenceSize: size, referenceGrams: value };
        updated.cellValues = computeRowCells(updated.sizes, size, value, updated.stepPct);
        return updated;
      })
    );
  };

  const handleApply = async (productType: string) => {
    if (!currentShop) return;
    const row = rows.find((r) => r.productType === productType);
    if (!row) return;

    if (!row.referenceSize || typeof row.referenceGrams !== 'number' || row.referenceGrams <= 0) {
      notifications.show({
        title: 'Champs manquants',
        message: 'Choisissez une taille pesée et un poids de référence valide',
        color: 'rust',
      });
      return;
    }
    if (typeof row.stepPct !== 'number') {
      notifications.show({ title: 'Champ manquant', message: 'Variation invalide', color: 'rust' });
      return;
    }

    setRows((prev) => prev.map((r) => (r.productType === productType ? { ...r, applying: true } : r)));

    try {
      const putResponse = await fetch('/api/settings/weight-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: currentShop.id,
          productType,
          referenceSize: row.referenceSize,
          referenceGrams: row.referenceGrams,
          stepPct: row.stepPct,
        }),
      });

      if (!putResponse.ok) {
        throw new Error('Impossible de sauvegarder la règle');
      }

      const applyResponse = await fetch('/api/settings/weight-rules/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: currentShop.id,
          productType,
          overwrite: row.overwrite,
        }),
      });

      const result: ApplyResult | { error: string } = await applyResponse.json();

      if (!applyResponse.ok || 'error' in result) {
        throw new Error('error' in result ? result.error : "Échec de l'application");
      }

      notifications.show({
        title: 'Poids appliqués',
        message: `${result.filled} poids écrits (${result.pushed} poussés vers Shopify, ${result.localOnly} en local seulement)${
          result.unresolved > 0 ? ` · ${result.unresolved} tailles non résolues` : ''
        }`,
        color: 'moss',
      });

      if (result.failures.length > 0) {
        notifications.show({
          title: `${result.failures.length} échec(s) Shopify`,
          message: result.failures
            .slice(0, 20)
            .map((f) => `${f.sku || f.variantId} — ${f.error}`)
            .join('\n'),
          color: 'rust',
          autoClose: false,
        });
      }

      await fetchData();
    } catch (err) {
      notifications.show({
        title: 'Erreur',
        message: err instanceof Error ? err.message : "Impossible d'appliquer la règle",
        color: 'rust',
      });
    } finally {
      setRows((prev) => prev.map((r) => (r.productType === productType ? { ...r, applying: false } : r)));
    }
  };

  const handleSaveUnitWeight = async (variant: UnweightedVariant) => {
    if (!currentShop) return;
    const value = unitDrafts[variant.id];
    if (typeof value !== 'number' || value <= 0) {
      notifications.show({ title: 'Poids invalide', message: 'Saisissez un poids en grammes', color: 'rust' });
      return;
    }

    setUnitSaving((prev) => ({ ...prev, [variant.id]: true }));
    try {
      const response = await fetch(`/api/inventory/variants/${variant.id}/weight`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: currentShop.id, weightGrams: value }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Échec de la sauvegarde');
      }

      notifications.show({ title: 'Poids enregistré', message: variant.sku || variant.title || '', color: 'moss' });
      setUnweighted((prev) => prev.filter((v) => v.id !== variant.id));
      setUnweightedTotal((prev) => Math.max(0, prev - 1));
    } catch (err) {
      notifications.show({
        title: 'Erreur',
        message: err instanceof Error ? err.message : 'Impossible de sauvegarder',
        color: 'rust',
      });
    } finally {
      setUnitSaving((prev) => ({ ...prev, [variant.id]: false }));
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
            Poids des <em>variantes</em>
          </h1>
          <div className={styles.sub}>
            Pesez une seule taille par type de produit, les autres se déduisent par variation cumulée
          </div>
        </div>
      </div>

      <div className={styles.card}>
        {rows.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Type de produit</th>
                  <th className={styles.th} style={{ width: 140 }}>Taille pesée</th>
                  <th className={styles.th} style={{ width: 130 }}>Poids réf. (g)</th>
                  <th className={styles.th} style={{ width: 110 }}>Variation</th>
                  {columns.map((size) => (
                    <th key={size} className={styles.th} style={{ width: 110 }}>{size}</th>
                  ))}
                  <th className={styles.th} style={{ width: 160 }}>Écraser</th>
                  <th className={styles.th} style={{ width: 110 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.productType} className={styles.tr}>
                    <td className={styles.td}>{row.productType}</td>
                    <td className={styles.td}>
                      <Select
                        data={row.sizes}
                        value={row.referenceSize || null}
                        onChange={(v) => v && patchRow(row.productType, { referenceSize: v })}
                        allowDeselect={false}
                        styles={{ input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' } }}
                      />
                    </td>
                    <td className={styles.td}>
                      <NumberInput
                        value={row.referenceGrams}
                        onChange={(v) => patchRow(row.productType, { referenceGrams: typeof v === 'number' ? v : '' })}
                        min={1}
                        styles={{
                          input: {
                            backgroundColor: 'var(--cream)',
                            borderColor: 'var(--divider)',
                            fontWeight: 700,
                          },
                        }}
                      />
                    </td>
                    <td className={styles.td}>
                      <NumberInput
                        value={row.stepPct}
                        onChange={(v) => patchRow(row.productType, { stepPct: typeof v === 'number' ? v : '' })}
                        suffix=" %"
                        step={0.5}
                        decimalScale={2}
                        styles={{ input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' } }}
                      />
                    </td>
                    {columns.map((size) => {
                      if (!row.sizes.includes(size)) {
                        return (
                          <td key={size} className={styles.td} style={{ textAlign: 'center', color: 'var(--slate-muted)' }}>
                            &mdash;
                          </td>
                        );
                      }
                      if (size === row.referenceSize) {
                        return (
                          <td key={size} className={styles.td}>
                            <div style={{ fontWeight: 700, color: 'var(--slate)' }}>
                              {row.referenceGrams === '' ? '—' : `${row.referenceGrams} g`}
                            </div>
                          </td>
                        );
                      }
                      const value = row.cellValues[size];
                      return (
                        <td key={size} className={styles.td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <NumberInput
                              value={value}
                              onChange={(v) => handleCellChange(row.productType, size, typeof v === 'number' ? v : '')}
                              min={1}
                              size="xs"
                              styles={{
                                input: {
                                  backgroundColor: 'var(--cream-warm)',
                                  borderColor: 'var(--divider)',
                                  color: 'var(--slate-muted)',
                                  width: 64,
                                },
                              }}
                            />
                            <Tooltip label="Faire de ce poids la référence">
                              <button
                                className={styles.iconButton}
                                style={{ width: 26, height: 26 }}
                                onClick={() => handlePromote(row.productType, size)}
                              >
                                <IconFlag size={14} />
                              </button>
                            </Tooltip>
                          </div>
                        </td>
                      );
                    })}
                    <td className={styles.td}>
                      <Checkbox
                        label="écraser les poids existants"
                        checked={row.overwrite}
                        onChange={(e) => patchRow(row.productType, { overwrite: e.currentTarget.checked })}
                        color="moss"
                      />
                    </td>
                    <td className={styles.td}>
                      <button
                        className={styles.primaryButton}
                        onClick={() => handleApply(row.productType)}
                        disabled={row.applying}
                      >
                        {row.applying ? 'Application…' : 'Appliquer'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.cardBody}>
            <p className={styles.emptyStateText}>Aucun type de produit trouvé.</p>
          </div>
        )}
      </div>

      {unweighted.length > 0 && (
        <div className={styles.card} style={{ marginTop: 28 }}>
          <div className={styles.cardHead}>
            <p className={styles.cardHeadTitle}>Variantes encore sans poids</p>
            <p className={styles.cardHeadSub}>
              {unweightedTotal} variante{unweightedTotal > 1 ? 's' : ''} sans poids
              {unweightedTotal > unweighted.length ? ` (${unweighted.length} affichées)` : ''}
            </p>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>SKU</th>
                <th className={styles.th}>Variante</th>
                <th className={styles.th}>Type</th>
                <th className={styles.th} style={{ width: 160 }}>Poids (g)</th>
                <th className={styles.th} style={{ width: 100 }} />
              </tr>
            </thead>
            <tbody>
              {unweighted.map((v) => (
                <tr key={v.id} className={styles.tr}>
                  <td className={styles.td}>{v.sku || '—'}</td>
                  <td className={styles.td}>{v.title || '—'}</td>
                  <td className={styles.td}>{v.productType}</td>
                  <td className={styles.td}>
                    <NumberInput
                      value={unitDrafts[v.id] ?? ''}
                      onChange={(val) =>
                        setUnitDrafts((prev) => ({ ...prev, [v.id]: typeof val === 'number' ? val : '' }))
                      }
                      min={1}
                      size="xs"
                      styles={{ input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' } }}
                    />
                  </td>
                  <td className={styles.td}>
                    <button
                      className={styles.ghostButton}
                      onClick={() => handleSaveUnitWeight(v)}
                      disabled={!!unitSaving[v.id]}
                    >
                      {unitSaving[v.id] ? '…' : 'Enregistrer'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
