'use client';

import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Loader, Paper, Table, Button, Group, Modal, NumberInput, TextInput,
  Stack, Text, Alert, SimpleGrid, ActionIcon,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconArrowLeft, IconPrinter, IconLock, IconAlertTriangle,
} from '@tabler/icons-react';
import { useDebounce } from '@/hooks/useDebounce';
import styles from './douane-detail.module.scss';

interface Passage {
  id: string;
  shop_id: string;
  location_id: string;
  location_name: string;
  status: 'open' | 'closed';
  reference: string | null;
  departed_on: string;
  eur_to_chf: number;
  vat_pct: number;
  gross_weight_kg: number | null;
  origin: string;
  prices_chf_ttc: Record<string, number>;
  customs_labels: Record<string, string>;
  packaging_kg: Record<string, number>;
  departure_snapshot_at: string;
  returned_on: string | null;
  return_snapshot_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DeclarationItem {
  id: string;
  declaration_id: string;
  variant_id: string | null;
  product_title: string;
  product_type: string | null;
  image_url: string | null;
  variant_title: string | null;
  size: string | null;
  color: string | null;
  qty_departed: number;
  qty_returned: number | null;
  qty_sold_recorded: number | null;
  weight_grams: number | null;
  unit_cost_textile: number | null;
  unit_cost_print: number | null;
  unit_price_eur: number | null;
  incomplete: boolean;
}

interface FormState {
  eurToChf: number | '';
  vatPct: number | '';
  grossWeightKg: number | '';
  reference: string;
  pricesChfTtc: Record<string, number | ''>;
  /** Libellé douanier par type : « T-shirt » pour « Le Confort ». */
  customsLabels: Record<string, string>;
  /** Poids des caisses par type, en kg. */
  packagingKg: Record<string, number | ''>;
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatChf(n: number): string {
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CHF`;
}

function formatEur(n: number): string {
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

export default function DouanePassageDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [passage, setPassage] = useState<Passage | null>(null);
  const [items, setItems] = useState<DeclarationItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeModalOpened, closeModal] = useDisclosure(false);

  const hydratedRef = useRef(false);
  const [form, setForm] = useState<FormState>({
    eurToChf: '',
    vatPct: '',
    grossWeightKg: '',
    reference: '',
    pricesChfTtc: {},
    customsLabels: {},
    packagingKg: {},
  });

  const fetchPassage = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/customs/passages/${id}`);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      const data = await res.json();
      setPassage(data.passage);
      setItems(data.items || []);

      if (!hydratedRef.current) {
        const prices: Record<string, number | ''> = {};
        for (const [k, v] of Object.entries((data.passage?.prices_chf_ttc ?? {}) as Record<string, unknown>)) {
          const n = Number(v);
          if (Number.isFinite(n)) prices[k] = n;
        }
        const labels: Record<string, string> = {};
        for (const [k, v] of Object.entries((data.passage?.customs_labels ?? {}) as Record<string, unknown>)) {
          if (typeof v === 'string') labels[k] = v;
        }
        const packs: Record<string, number> = {};
        for (const [k, v] of Object.entries((data.passage?.packaging_kg ?? {}) as Record<string, unknown>)) {
          const n = Number(v);
          if (Number.isFinite(n)) packs[k] = n;
        }
        setForm({
          eurToChf: data.passage?.eur_to_chf ?? '',
          vatPct: data.passage?.vat_pct ?? '',
          grossWeightKg: data.passage?.gross_weight_kg ?? '',
          reference: data.passage?.reference ?? '',
          pricesChfTtc: prices,
          customsLabels: labels,
          packagingKg: packs,
        });
        hydratedRef.current = true;
      }
    } catch (err) {
      console.error('Error fetching passage:', err);
      notifications.show({ title: 'Erreur', message: 'Impossible de charger le passage', color: 'red' });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchPassage();
  }, [fetchPassage]);

  // --- Panneau de paramètres : PATCH débouncé ---
  const savePatch = useCallback(async (next: FormState) => {
    const pricesChfTtc: Record<string, number> = {};
    for (const [k, v] of Object.entries(next.pricesChfTtc)) {
      if (typeof v === 'number' && v > 0) pricesChfTtc[k] = v;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        reference: next.reference,
        grossWeightKg: next.grossWeightKg === '' ? null : Number(next.grossWeightKg),
        pricesChfTtc,
        customsLabels: next.customsLabels,
        packagingKg: Object.fromEntries(
          Object.entries(next.packagingKg).filter(([, v]) => typeof v === 'number'),
        ),
      };
      if (typeof next.eurToChf === 'number' && next.eurToChf > 0) body.eurToChf = next.eurToChf;
      if (typeof next.vatPct === 'number' && next.vatPct >= 0) body.vatPct = next.vatPct;

      const res = await fetch(`/api/customs/passages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        // On garde la vérité serveur pour l'en-tête (dates, etc.), sans re-hydrater le
        // formulaire : ça écraserait ce que l'utilisateur est en train de taper.
        setPassage(data.passage);
      } else {
        notifications.show({ title: 'Erreur', message: 'Enregistrement impossible', color: 'red' });
      }
    } catch (err) {
      console.error('Error saving passage:', err);
      notifications.show({ title: 'Erreur', message: 'Enregistrement impossible', color: 'red' });
    } finally {
      setSaving(false);
    }
  }, [id]);

  const debouncedSave = useDebounce(savePatch, 600);

  const updateForm = useCallback((patch: Partial<FormState>) => {
    setForm((prev) => {
      const next = { ...prev, ...patch };
      debouncedSave(next);
      return next;
    });
  }, [debouncedSave]);

  const updatePrice = useCallback((type: string, value: number | '') => {
    setForm((prev) => {
      const next = { ...prev, pricesChfTtc: { ...prev.pricesChfTtc, [type]: value } };
      debouncedSave(next);
      return next;
    });
  }, [debouncedSave]);

  // Saisie libre : on met à jour l'affichage sans rien envoyer. L'enregistrement
  // part à la sortie du champ — taper ne doit jamais déclencher de requête.
  const updateLabel = useCallback((type: string, value: string) => {
    setForm((prev) => ({ ...prev, customsLabels: { ...prev.customsLabels, [type]: value } }));
  }, []);

  const updatePackaging = useCallback((type: string, value: number | '') => {
    setForm((prev) => {
      const next = { ...prev, packagingKg: { ...prev.packagingKg, [type]: value } };
      debouncedSave(next);
      return next;
    });
  }, [debouncedSave]);

  const commitLabels = useCallback(() => {
    setForm((prev) => {
      savePatch(prev);
      return prev;
    });
  }, [savePatch]);

  // --- Types de produits présents dans l'instantané ---
  const productTypes = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      if (it.product_type) set.add(it.product_type);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));
  }, [items]);

  // --- Totaux et valeur douanière, recalculés en direct depuis le formulaire ---
  const computed = useMemo(() => {
    const eurToChf = typeof form.eurToChf === 'number' ? form.eurToChf : (passage?.eur_to_chf ?? 0);
    const vatPct = typeof form.vatPct === 'number' ? form.vatPct : (passage?.vat_pct ?? 8.1);
    const grossWeightKg = typeof form.grossWeightKg === 'number' ? form.grossWeightKg : null;

    let pieces = 0;
    let netWeightGrams = 0;
    let customsValue = 0;
    let importVat = 0;

    const lines = items.map((it) => {
      const typedPrice = it.product_type ? form.pricesChfTtc[it.product_type] : undefined;
      const priceTtc = typeof typedPrice === 'number' && typedPrice > 0
        ? typedPrice
        : (it.unit_price_eur ?? 0) * eurToChf;
      const unitCustomsValue = vatPct > 0 ? priceTtc / (1 + vatPct / 100) : priceTtc;
      const lineCustomsValue = unitCustomsValue * it.qty_departed;
      // TVA reclamee par la douane a l'entree, assise sur la valeur douaniere HT
      const lineImportVat = lineCustomsValue * (vatPct / 100);
      const lineWeightGrams = (it.weight_grams ?? 0) * it.qty_departed;

      pieces += it.qty_departed;
      netWeightGrams += lineWeightGrams;
      customsValue += lineCustomsValue;
      importVat += lineImportVat;

      return { ...it, unitCustomsValue, lineCustomsValue, lineImportVat, lineWeightGrams };
    });

    return {
      eurToChf,
      vatPct,
      grossWeightKg,
      pieces,
      netWeightKg: netWeightGrams / 1000,
      customsValue,
      importVat,
      lines,
    };
    // Volontairement fin : les libellés douaniers n'entrent dans aucun calcul.
    // Les inclure ferait recalculer 489 lignes à chaque frappe.
  }, [items, form.eurToChf, form.vatPct, form.grossWeightKg, form.pricesChfTtc, passage]);

  const isClosed = passage?.status === 'closed';

  // --- Synthese par type : ce que la douane lit en tete de dossier ---
  const summary = useMemo(() => {
    const rows = new Map<string, { qty: number; netG: number; customs: number; ret: number }>();
    for (const it of computed.lines) {
      const type = it.product_type ?? '(sans type)';
      const r = rows.get(type) ?? { qty: 0, netG: 0, customs: 0, ret: 0 };
      r.qty += it.qty_departed;
      r.netG += it.lineWeightGrams;
      r.customs += it.lineCustomsValue;
      r.ret += it.qty_returned ?? 0;
      rows.set(type, r);
    }
    // Le brut d'un type = son net + le poids de SES caisses. Les t-shirts et les
    // sweats ne voyagent pas dans les mêmes, un poids brut unique serait faux.
    const packOf = (type: string) => {
      const v = form.packagingKg[type];
      return typeof v === 'number' ? v : 0;
    };
    const totalPackaging = [...rows.keys()].reduce((n, t) => n + packOf(t), 0);
    const totalNetKg = [...rows.values()].reduce((n, r) => n + r.netG, 0) / 1000;
    const built = [...rows.entries()];
    const agg = built.reduce((acc, [type, r]) => {
      const vendu = Math.max(0, r.qty - r.ret);
      const unitG = r.qty > 0 ? r.netG / r.qty : 0;
      const unitHt = r.qty > 0 ? r.customs / r.qty : 0;
      acc.reste += r.ret;
      acc.vendu += vendu;
      acc.netResteKg += (unitG * r.ret) / 1000;
      acc.netVenduKg += (unitG * vendu) / 1000;
      acc.valResteChf += unitHt * r.ret;
      acc.valVenduChf += unitHt * vendu;
      return acc;
    }, { reste: 0, vendu: 0, netResteKg: 0, netVenduKg: 0, valResteChf: 0, valVenduChf: 0 });

    return {
      totalPackaging,
      totalGrossKg: totalNetKg + totalPackaging,
      totalReste: agg.reste,
      totalVendu: agg.vendu,
      totalNetResteKg: agg.netResteKg,
      totalNetVenduKg: agg.netVenduKg,
      totalValResteChf: agg.valResteChf,
      totalValVenduChf: agg.valVenduChf,
      rows: [...rows.entries()]
        .map(([type, r]) => {
          // « Vendu » au sens douanier : ce qui est resté en Suisse, soit parti − revenu.
          const vendu = Math.max(0, r.qty - r.ret);
          const unitG = r.qty > 0 ? r.netG / r.qty : 0;
          const unitHt = r.qty > 0 ? r.customs / r.qty : 0;
          return {
            type,
            ...r,
            packagingKg: packOf(type),
            grossKg: r.netG / 1000 + packOf(type),
            vendu,
            netResteKg: (unitG * r.ret) / 1000,
            netVenduKg: (unitG * vendu) / 1000,
            valResteChf: unitHt * r.ret,
            valVenduChf: unitHt * vendu,
          };
        })
        .sort((a, b) => b.qty - a.qty),
    };
  }, [computed, form.packagingKg]);

  const missing = useMemo(() => {
    let weight = 0;
    let rule = 0;
    let price = 0;
    for (const it of items) {
      if (!it.weight_grams) weight++;
      if (it.unit_cost_textile === null) rule++;
      if (!it.unit_price_eur) price++;
    }
    const parts: string[] = [];
    if (weight > 0) parts.push(`${weight} sans poids`);
    if (rule > 0) parts.push(`${rule} sans règle de prix`);
    if (price > 0) parts.push(`${price} sans prix de vente`);
    return { weight, rule, price, total: items.filter((i) => i.incomplete).length, label: parts.join(' · ') };
  }, [items]);

  const groups = useMemo(() => {
    const map = new Map<string, { title: string; totalQty: number; items: typeof computed.lines }>();
    for (const it of computed.lines) {
      const key = it.product_title;
      if (!map.has(key)) map.set(key, { title: key, totalQty: 0, items: [] });
      const g = map.get(key)!;
      g.items.push(it);
      g.totalQty += it.qty_departed;
    }
    return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title, 'fr'));
  }, [computed.lines]);

  const handleClose = useCallback(async () => {
    setClosing(true);
    try {
      const res = await fetch(`/api/customs/passages/${id}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        notifications.show({ title: 'Erreur', message: data.error || 'Clôture impossible', color: 'red' });
        return;
      }
      notifications.show({
        title: 'Passage clôturé',
        message: `${data.lines} ligne(s) réconciliée(s) avec l'instantané de retour.`,
        color: 'green',
      });
      closeModal.close();
      hydratedRef.current = false; // le retour a changé les paramètres figés côté serveur : on ré-hydrate
      await fetchPassage();
    } catch (err) {
      console.error('Error closing passage:', err);
      notifications.show({ title: 'Erreur', message: 'Clôture impossible', color: 'red' });
    } finally {
      setClosing(false);
    }
  }, [id, closeModal, fetchPassage]);

  if (loading && !passage) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingWrap}><Loader color="moss" /></div>
      </div>
    );
  }

  if (notFound || !passage) {
    return (
      <div className={styles.container}>
        <div className={styles.errorWrap}>Passage introuvable.</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.pageHead}>
        <Group align="flex-start" gap="xs">
          <ActionIcon variant="subtle" color="slate" onClick={() => router.push('/ivy/inventaire/douane')}>
            <IconArrowLeft size={18} />
          </ActionIcon>
          <div>
            <div className={styles.eyebrow}>Passage en douane</div>
            <h1 className={styles.title}>{passage.location_name}</h1>
            <div className={styles.sub}>
              <span className={passage.status === 'open' ? styles.rustText : undefined}>
                {passage.status === 'open' ? 'Ouvert' : 'Clôturé'}
              </span>
              <span className={styles.subSep}>·</span>
              <span>Départ le {formatDate(passage.departed_on)}</span>
              {passage.returned_on && (
                <>
                  <span className={styles.subSep}>·</span>
                  <span>Retour le {formatDate(passage.returned_on)}</span>
                </>
              )}
              {passage.reference && (
                <>
                  <span className={styles.subSep}>·</span>
                  <span>Réf. {passage.reference}</span>
                </>
              )}
            </div>
          </div>
        </Group>
      </div>

      <Group gap="xs" className={styles.actions}>
        <Button
          variant="light"
          color="slate"
          leftSection={<IconPrinter size={16} />}
          onClick={() => window.open(`/api/customs/passages/${id}/document`, '_blank')}
        >
          Imprimer le document
        </Button>
        {passage.status === 'open' && (
          <Button color="rust" leftSection={<IconLock size={16} />} onClick={closeModal.open}>
            Clôturer — retour de Suisse
          </Button>
        )}
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Pièces</div>
          <div className={styles.metricValue}>{computed.pieces.toLocaleString('fr-FR')}</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Poids net</div>
          <div className={styles.metricValue}>
            {computed.netWeightKg.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
            <span className={styles.metricUnit}>kg</span>
          </div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Poids brut</div>
          <div className={styles.metricValue}>
            {computed.grossWeightKg != null
              ? computed.grossWeightKg.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
              : '—'}
            <span className={styles.metricUnit}>kg</span>
          </div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Valeur douanière</div>
          <div className={styles.metricValue}>{formatChf(computed.customsValue)}</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>TVA à l&apos;import ({computed.vatPct} %)</div>
          <div className={styles.metricValue}>{formatChf(computed.importVat)}</div>
          <Text size="xs" c="dimmed" mt={4}>
            Estimation de ce que la douane réclamera à l&apos;entrée.
          </Text>
        </div>
      </SimpleGrid>

      <Paper className={styles.panel} radius="md">
        <div className={styles.panelHead}>
          <h3 className={styles.panelTitle}>Paramètres</h3>
          <span className={styles.savingHint}>{saving ? 'Enregistrement…' : 'Enregistré'}</span>
        </div>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="sm">
          <NumberInput
            label="Taux (1 EUR = ? CHF)"
            value={form.eurToChf}
            onChange={(v) => updateForm({ eurToChf: typeof v === 'number' ? v : '' })}
            decimalScale={4}
            step={0.01}
            min={0}
          />
          <NumberInput
            label="TVA suisse (%)"
            value={form.vatPct}
            onChange={(v) => updateForm({ vatPct: typeof v === 'number' ? v : '' })}
            suffix=" %"
            decimalScale={2}
            step={0.1}
            min={0}
          />
          <NumberInput
            label="Poids brut (kg)"
            value={form.grossWeightKg}
            onChange={(v) => updateForm({ grossWeightKg: typeof v === 'number' ? v : '' })}
            decimalScale={3}
            step={1}
            min={0}
          />
          <TextInput
            label="Référence 1187"
            value={form.reference}
            onChange={(e) => updateForm({ reference: e.currentTarget.value })}
          />
        </SimpleGrid>

        {productTypes.length > 0 && (
          <>
            <div className={styles.subLabel}>Prix de vente TTC par type (CHF)</div>
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
              {productTypes.map((type) => (
                <NumberInput
                  key={type}
                  label={type}
                  value={form.pricesChfTtc[type] ?? ''}
                  onChange={(v) => updatePrice(type, typeof v === 'number' ? v : '')}
                  suffix=" CHF"
                  decimalScale={2}
                  step={5}
                  min={0}
                  size="xs"
                />
              ))}
            </SimpleGrid>
          </>
        )}
      </Paper>

      <Paper className={styles.panel} radius="md" mb="md">
        <div className={styles.panelHead}>
          <h3 className={styles.panelTitle}>Synthèse douanière</h3>
          <Button
            variant="light"
            color="moss"
            size="xs"
            leftSection={<IconPrinter size={14} />}
            onClick={() => window.open(`/api/customs/passages/${id}/document?only=resume`, '_blank')}
          >
            Imprimer cette feuille
          </Button>
        </div>
        <Text size="xs" c="dimmed" mb="sm">
          La colonne <b>Objet</b> est ce que lira le douanier : mets-y un mot courant
          (« T-shirt », « Sweat-shirt »), pas le nom commercial. Elle est enregistrée avec le passage.
        </Text>
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ minWidth: 180 }}>Objet (libellé douanier)</Table.Th>
              <Table.Th>Type Ivy</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Qté de départ</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Poids net</Table.Th>
              <Table.Th style={{ textAlign: 'right', minWidth: 110 }}>Caisses (kg)</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Poids brut</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Valeur douanière au départ (HT)</Table.Th>
              {/* Toujours affichées : à l'aller elles s'impriment vides, pour être
                  remplies à la main au festival. */}
              {['Qté restante', 'Qté vendue', 'Poids restant', 'Poids vendu', 'Valeur restante', 'Valeur vendue'].map((h) => (
                <Table.Th
                  key={h}
                  style={{ textAlign: 'right', color: isClosed ? undefined : 'var(--mantine-color-dimmed)' }}
                >
                  {h}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {summary.rows.map((r) => (
              <Table.Tr key={r.type}>
                <Table.Td>
                  <TextInput
                    size="xs"
                    placeholder={r.type}
                    value={form.customsLabels[r.type] ?? ''}
                    onChange={(e) => updateLabel(r.type, e.currentTarget.value)}
                    onBlur={commitLabels}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                  />
                </Table.Td>
                <Table.Td><Text size="xs" c="dimmed">{r.type}</Text></Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{r.qty}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  {(r.netG / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  <NumberInput
                    size="xs"
                    value={form.packagingKg[r.type] ?? ''}
                    onChange={(v) => updatePackaging(r.type, typeof v === 'number' ? v : '')}
                    decimalScale={3}
                    step={0.5}
                    min={0}
                    placeholder="0"
                    styles={{ input: { textAlign: 'right' } }}
                  />
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  {r.grossKg.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{formatChf(r.customs)}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{isClosed ? r.ret : '—'}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{isClosed ? r.vendu : '—'}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{isClosed ? `${r.netResteKg.toFixed(3)} kg` : '—'}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{isClosed ? `${r.netVenduKg.toFixed(3)} kg` : '—'}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{isClosed ? formatChf(r.valResteChf) : '—'}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{isClosed ? formatChf(r.valVenduChf) : '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr>
              <Table.Td colSpan={2}><b>TOTAL</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{computed.pieces}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                <b>{computed.netWeightKg.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg</b>
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                <b>{summary.totalPackaging.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg</b>
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                <b>{summary.totalGrossKg.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg</b>
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{formatChf(computed.customsValue)}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{isClosed ? summary.totalReste : '—'}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{isClosed ? summary.totalVendu : '—'}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{isClosed ? `${summary.totalNetResteKg.toFixed(3)} kg` : '—'}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{isClosed ? `${summary.totalNetVenduKg.toFixed(3)} kg` : '—'}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{isClosed ? formatChf(summary.totalValResteChf) : '—'}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{isClosed ? formatChf(summary.totalValVenduChf) : '—'}</b></Table.Td>
            </Table.Tr>
          </Table.Tfoot>
        </Table>
        {false && (
          <Alert color="rust" icon={<IconAlertTriangle size={16} />} mt="xs">
            Le poids brut saisi ({computed.grossWeightKg} kg) est <b>inférieur au poids net</b>
            ({computed.netWeightKg.toFixed(3)} kg). Le brut comprend le net plus les caisses :
            il ne peut pas être plus petit. Vérifie ta pesée dans les paramètres.
          </Alert>
        )}
        <Text size="xs" c="dimmed" mt="xs">
          Le poids brut d&apos;une ligne vaut son poids net plus celui de ses caisses.
          Laisse à zéro si ce type voyage sans emballage propre.
          {!isClosed && (
            <> Les six dernières colonnes se rempliront <b>toutes seules à la clôture</b>,
            en comparant l&apos;instantané de départ au stock du moment. Elles apparaissent
            dès maintenant pour figurer sur le document d&apos;aller.</>
          )}
        </Text>
      </Paper>

      {missing.total > 0 && (
        <Alert color="rust" icon={<IconAlertTriangle size={16} />} title={`${missing.total} ligne(s) incomplète(s)`} mb="md">
          <Text size="sm">{missing.label}</Text>
        </Alert>
      )}

      <Paper className={styles.panel} radius="md">
        <div className={styles.panelHead}>
          <h3 className={styles.panelTitle}>Lignes de l&apos;instantané de départ</h3>
        </div>
        <div className={styles.tableWrap}>
          <Table striped verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Taille</Table.Th>
                <Table.Th>Couleur</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Qté partie</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Poids</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Coût textile</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Coût impression</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Valeur douanière</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>TVA à l&apos;import</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {groups.map((group) => (
                <Fragment key={group.title}>
                  <Table.Tr className={styles.groupRow}>
                    <Table.Td colSpan={8}>{group.title} · {group.totalQty} pièce(s)</Table.Td>
                  </Table.Tr>
                  {group.items.map((it) => (
                    <Table.Tr key={it.id} className={it.incomplete ? styles.incompleteRow : undefined}>
                      <Table.Td>{it.size || '—'}</Table.Td>
                      <Table.Td>{it.color || '—'}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{it.qty_departed}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {it.weight_grams ? `${(it.lineWeightGrams / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg` : '—'}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {it.unit_cost_textile != null ? formatEur(it.unit_cost_textile) : '—'}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {it.unit_cost_print != null ? formatEur(it.unit_cost_print) : '—'}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{formatChf(it.lineCustomsValue)}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{formatChf(it.lineImportVat)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Fragment>
              ))}
              {groups.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={8}>
                    <Text c="dimmed" ta="center" py="md">Aucune ligne dans cet instantané.</Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </div>
      </Paper>

      {passage.status === 'closed' && (
        <Paper className={styles.panel} radius="md">
          <div className={styles.panelHead}>
            <h3 className={styles.panelTitle}>Réconciliation du retour</h3>
          </div>
          <Text size="xs" c="dimmed" mb="sm">
            L&apos;écart correspond à de la casse, un cadeau, ou une pièce vendue sans passer en caisse.
          </Text>
          <div className={styles.tableWrap}>
            <Table striped verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Produit</Table.Th>
                  <Table.Th>Taille</Table.Th>
                  <Table.Th>Couleur</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Parti</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Revenu</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Vendu (caisse)</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Écart</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((it) => {
                  const returned = it.qty_returned ?? 0;
                  const sold = it.qty_sold_recorded ?? 0;
                  const gap = it.qty_departed - returned - sold;
                  return (
                    <Table.Tr key={it.id} className={gap !== 0 ? styles.gapRow : undefined}>
                      <Table.Td>{it.product_title}</Table.Td>
                      <Table.Td>{it.size || '—'}</Table.Td>
                      <Table.Td>{it.color || '—'}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{it.qty_departed}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{returned}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{sold}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{gap > 0 ? `+${gap}` : gap}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </div>
        </Paper>
      )}

      <Modal opened={closeModalOpened} onClose={closeModal.close} title="Clôturer le passage" radius="md">
        <Stack gap="sm">
          <Text size="sm">
            Ceci fige l&apos;<b>instantané de retour</b> du stock à l&apos;emplacement <b>{passage.location_name}</b>{' '}
            et calcule la réconciliation (parti / revenu / vendu en caisse).
          </Text>
          <Text size="sm" fw={600} c="rust">
            Fais-le AVANT tout transfert de rapatriement du stock : une fois le transfert passé,
            l&apos;instantané de retour ne reflétera plus ce qui a réellement traversé la frontière.
          </Text>
          <Group justify="flex-end" mt="xs">
            <Button variant="subtle" color="gray" onClick={closeModal.close}>Annuler</Button>
            <Button color="rust" leftSection={<IconLock size={16} />} onClick={handleClose} loading={closing}>
              Confirmer la clôture
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
