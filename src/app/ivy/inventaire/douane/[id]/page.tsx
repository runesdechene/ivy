'use client';

import { Fragment, memo, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader, Paper, Table, Button, Group, Modal, NumberInput, TextInput,
  Stack, Text, Alert, SimpleGrid, ActionIcon, Anchor, Checkbox,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconArrowLeft, IconPrinter, IconLock, IconAlertTriangle,
} from '@tabler/icons-react';
import { useDebounce } from '@/hooks/useDebounce';
import { formatSh } from '@/lib/customs/tariffs';
import { caissesParType, separerFournitures, totauxMateriel, type ObjetMateriel } from '@/lib/customs/materiel';
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
  /** Origine du textile (BD). */
  origin: string;
  /** Pays d'origine en case 10 du 11.74 (FR). */
  origine_declaree: string | null;
  designation_formulaire: string | null;
  tarif_formulaire: string | null;
  bureau_douane: string | null;
  prices_chf_ttc: Record<string, number>;
  /** Matériel d'exposition du voyage, copié du modèle de l'emplacement. */
  materiel: ObjetMateriel[];
  materiel_imprime: boolean;
  customs_labels: Record<string, string>;
  doc_titre: string | null;
  raison_sociale: string | null;
  nom_prenom: string | null;
  adresse_siege: string | null;
  adresse_exposition: string | null;
  date_exposition: string | null;
  date_retour_prevue: string | null;
  date_apurement: string | null;
  tariff_by_type: Record<string, { position?: string; origine?: string; tva?: number }>;
  doc_sous_titre: string | null;
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

/**
 * Valeur d'un champ numérique : un nombre, ou le texte en cours de frappe.
 *
 * Mantine renvoie « 0. » en TEXTE tant que ce n'est pas encore un nombre. Le
 * ramener à '' effaçait le champ au premier point : impossible de taper 0,94.
 */
type Saisie = number | string;

/** Le nombre porté par une saisie, ou null si elle n'en est pas (encore) un. */
function nombre(v: Saisie): number | null {
  if (typeof v === 'number') return v;
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

interface FormState {
  eurToChf: Saisie;
  vatPct: Saisie;
  grossWeightKg: Saisie;
  reference: string;
  pricesChfTtc: Record<string, number | ''>;
  /** Titre et sous-titre de la feuille imprimée. */
  docTitre: string;
  docSousTitre: string;
  departedOn: string;
  raisonSociale: string;
  nomPrenom: string;
  adresseSiege: string;
  adresseExposition: string;
  dateExposition: string;
  dateRetourPrevue: string;
  dateApurement: string;
  /** Cases fixes du 11.74 : 10, 15, 17, 20. Et l'origine du textile, distincte. */
  origineDeclaree: string;
  bureauDouane: string;
  designationFormulaire: string;
  tarifFormulaire: string;
  origin: string;
}

/**
 * Champ de saisie isolé, avec son propre état.
 *
 * Sans cette isolation, chaque frappe remonte dans l'état de la page et re-rend
 * les centaines de lignes de l'instantané — la saisie devient inutilisable.
 * Ici, taper ne touche personne : la valeur ne remonte qu'à la sortie du champ.
 */
const LabelCell = memo(function LabelCell({
  initial, placeholder, onCommit,
}: { initial: string; placeholder: string; onCommit: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  const seen = useRef(initial);
  useEffect(() => {
    if (seen.current !== initial) { seen.current = initial; setValue(initial); }
  }, [initial]);
  return (
    <TextInput
      size="xs"
      placeholder={placeholder}
      value={value}
      onChange={(e) => setValue(e.currentTarget.value)}
      onBlur={() => { if (value !== initial) onCommit(value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
});

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
    docTitre: '',
    docSousTitre: '',
    departedOn: '',
    raisonSociale: '',
    nomPrenom: '',
    adresseSiege: '',
    adresseExposition: '',
    dateExposition: '',
    dateRetourPrevue: '',
    dateApurement: '',
    origineDeclaree: '',
    bureauDouane: '',
    designationFormulaire: '',
    tarifFormulaire: '',
    origin: '',
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
        setForm({
          eurToChf: data.passage?.eur_to_chf ?? '',
          vatPct: data.passage?.vat_pct ?? '',
          grossWeightKg: data.passage?.gross_weight_kg ?? '',
          reference: data.passage?.reference ?? '',
          pricesChfTtc: prices,
          docTitre: data.passage?.doc_titre ?? '',
          docSousTitre: data.passage?.doc_sous_titre ?? '',
          departedOn: data.passage?.departed_on ?? '',
          raisonSociale: data.passage?.raison_sociale ?? '',
          nomPrenom: data.passage?.nom_prenom ?? '',
          adresseSiege: data.passage?.adresse_siege ?? '',
          adresseExposition: data.passage?.adresse_exposition ?? '',
          dateExposition: data.passage?.date_exposition ?? '',
          dateRetourPrevue: data.passage?.date_retour_prevue ?? '',
          dateApurement: data.passage?.date_apurement ?? '',
          origineDeclaree: data.passage?.origine_declaree ?? '',
          bureauDouane: data.passage?.bureau_douane ?? '',
          designationFormulaire: data.passage?.designation_formulaire ?? '',
          tarifFormulaire: data.passage?.tarif_formulaire ?? '',
          origin: data.passage?.origin ?? '',
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
        grossWeightKg: nombre(next.grossWeightKg),
        pricesChfTtc,
        // Libellés et codes SH ne partent plus d'ici : ils vivent dans le référentiel
        // douanier (Paramètres → Douane), et sont figés côté serveur à la clôture.
        docTitre: next.docTitre,
        docSousTitre: next.docSousTitre,
        departedOn: next.departedOn || null,
        raisonSociale: next.raisonSociale,
        nomPrenom: next.nomPrenom,
        adresseSiege: next.adresseSiege,
        adresseExposition: next.adresseExposition,
        dateExposition: next.dateExposition,
        dateRetourPrevue: next.dateRetourPrevue || null,
        dateApurement: next.dateApurement || null,
        bureauDouane: next.bureauDouane,
        designationFormulaire: next.designationFormulaire,
        tarifFormulaire: next.tarifFormulaire,
      };
      // Une origine vide ne s'enregistre pas : la colonne est obligatoire.
      if (next.origineDeclaree.trim()) body.origineDeclaree = next.origineDeclaree;
      if (next.origin.trim()) body.origin = next.origin;
      // Une saisie inachevée (« 0. ») ne s'enregistre pas : on garde la dernière valeur valable.
      const taux = nombre(next.eurToChf);
      const tva = nombre(next.vatPct);
      if (taux !== null && taux > 0) body.eurToChf = taux;
      if (tva !== null && tva >= 0) body.vatPct = tva;

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

  // La frappe vit dans le composant enfant. Ici on ne reçoit que la valeur
  // finale, à la sortie du champ : un seul rendu, une seule requête.
  const commitDocField = useCallback((
    field: 'docTitre' | 'docSousTitre' | 'departedOn' | 'raisonSociale' | 'nomPrenom' | 'adresseSiege'
      | 'adresseExposition' | 'dateExposition' | 'dateRetourPrevue' | 'dateApurement'
      | 'origineDeclaree' | 'bureauDouane' | 'designationFormulaire' | 'tarifFormulaire' | 'origin',
    value: string,
  ) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      savePatch(next);
      return next;
    });
  }, [savePatch]);

  // Enregistrement ponctuel, hors formulaire (la case « Imprimer le matériel »).
  const patchPassage = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/customs/passages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Enregistrement impossible');
    setPassage(data.passage);
    return data.passage as Passage;
  }, [id]);

  // Matériel résolu côté serveur : modèle de l'emplacement si ouvert, figé si clôturé.
  // Les caisses vont dans le brut ; le reste est le matériel d'exposition.
  const { caisses: caissesEnregistrees, materiel: materielEnregistre } = separerFournitures(passage?.materiel ?? []);
  const totauxMat = totauxMateriel(materielEnregistre);
  const totauxCaisses = totauxMateriel(caissesEnregistrees);

  // --- Types de produits présents dans l'instantané ---
  const productTypes = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      if (it.product_type) set.add(it.product_type);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));
  }, [items]);

  /**
   * Libellé et code SH d'un type. Le serveur les a déjà résolus : depuis le
   * référentiel pour un passage ouvert, figés dans le passage s'il est clôturé.
   * Ils ne se modifient qu'à un endroit, Paramètres → Douane.
   */
  const libelleOf = useCallback((type: string) => passage?.customs_labels?.[type] ?? '', [passage]);
  const codeShOf = useCallback((type: string) => passage?.tariff_by_type?.[type]?.position ?? '', [passage]);

  // --- Totaux et valeur douanière, recalculés en direct depuis le formulaire ---
  const computed = useMemo(() => {
    const eurToChf = nombre(form.eurToChf) || Number(passage?.eur_to_chf ?? 0);
    const vatPct = nombre(form.vatPct) ?? Number(passage?.vat_pct ?? 8.1);
    const grossWeightKg = nombre(form.grossWeightKg);

    let pieces = 0;
    let netWeightGrams = 0;
    let customsValue = 0;
    let customsValueEur = 0;
    let importVat = 0;

    const lines = items.map((it) => {
      const typedPrice = it.product_type ? form.pricesChfTtc[it.product_type] : undefined;
      const priceTtc = typeof typedPrice === 'number' && typedPrice > 0
        ? typedPrice
        : (it.unit_price_eur ?? 0) * eurToChf;
      // Valeur en douane = prix d'ACHAT (textile + impression), déjà hors taxe.
      // Le prix de vente ne sert qu'à situer la marchandise, il n'entre pas ici.
      const unitCustomsEur = (it.unit_cost_textile ?? 0) + (it.unit_cost_print ?? 0);
      const unitCustomsValue = unitCustomsEur * eurToChf;
      const lineCustomsEur = unitCustomsEur * it.qty_departed;
      const lineCustomsValue = unitCustomsValue * it.qty_departed;
      // TVA reclamee par la douane a l'entree, assise sur la valeur douaniere HT
      const lineImportVat = lineCustomsValue * (vatPct / 100);
      const lineWeightGrams = (it.weight_grams ?? 0) * it.qty_departed;

      pieces += it.qty_departed;
      netWeightGrams += lineWeightGrams;
      customsValue += lineCustomsValue;
      customsValueEur += lineCustomsEur;
      importVat += lineImportVat;

      return { ...it, priceTtc, unitCustomsEur, unitCustomsValue, lineCustomsEur, lineCustomsValue, lineImportVat, lineWeightGrams };
    });

    return {
      eurToChf,
      vatPct,
      grossWeightKg,
      pieces,
      netWeightKg: netWeightGrams / 1000,
      customsValue,
      customsValueEur,
      importVat,
      lines,
    };
    // Volontairement fin : les libellés douaniers n'entrent dans aucun calcul.
    // Les inclure ferait recalculer 489 lignes à chaque frappe.
  }, [items, form.eurToChf, form.vatPct, form.grossWeightKg, form.pricesChfTtc, passage]);

  const isClosed = passage?.status === 'closed';

  // --- Synthese par type : ce que la douane lit en tete de dossier ---
  const summary = useMemo(() => {
    const rows = new Map<string, { qty: number; netG: number; customs: number; customsEur: number; ret: number }>();
    for (const it of computed.lines) {
      const type = it.product_type ?? '(sans type)';
      const r = rows.get(type) ?? { qty: 0, netG: 0, customs: 0, customsEur: 0, ret: 0 };
      r.qty += it.qty_departed;
      r.netG += it.lineWeightGrams;
      r.customs += it.lineCustomsValue;
      r.customsEur += it.lineCustomsEur;
      r.ret += it.qty_returned ?? 0;
      rows.set(type, r);
    }
    // Même règle que la feuille imprimée. Fournitures cochées « Caisse » : un seul
    // total, attribué à aucun type (une caisse les mélange). Passage ancien : ses
    // caisses par type, et le brut d'un type = son net + ses caisses.
    const caisses = caissesParType(passage?.materiel ?? [], passage?.packaging_kg ?? {});
    const brutParLigne = caisses.source !== 'caisses';
    const packOf = (type: string) => caisses.parType[type] ?? 0;
    const totalPackaging = brutParLigne
      ? [...rows.keys()].reduce((n, t) => n + packOf(t), 0)
      : caisses.totalKg;
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
      caissesSource: caisses.source,
      nombreCaisses: caisses.nombre,
      brutParLigne,
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
  }, [computed, passage]);

  /**
   * Poids brut du passage, avec la même règle que le document imprimé : net plus
   * caisses dès qu'une caisse est renseignée, sinon le poids brut global saisi.
   */
  const hasPackaging = summary.caissesSource !== 'aucune';
  const grossKg = hasPackaging ? summary.totalGrossKg : computed.grossWeightKg;

  /**
   * Les chiffres à recopier sur le 11.74, case par case.
   *
   * La valeur se déclare au franc, et la TVA se calcule sur CETTE valeur arrondie :
   * c'est le calcul que refait le système de la douane. La calculer sur les
   * centimes produirait un écart d'un centime entre la case 31 et leur écran.
   */
  const formulaire = useMemo(() => {
    const vat = computed.vatPct / 100;
    const ligne = (pieces: number, netKg: number, brutKg: number | null, valeurChf: number) => {
      const valeur = Math.round(valeurChf);
      return { pieces, netKg, brutKg, valeur, tva: Math.round(valeur * vat * 100) / 100 };
    };
    const total = ligne(computed.pieces, computed.netWeightKg, grossKg, computed.customsValue);

    // Une ligne par code SH, si le douanier demande la ventilation.
    const parCode = new Map<string, { types: string[]; pieces: number; netG: number; packKg: number; chf: number }>();
    for (const r of summary.rows) {
      const code = formatSh(codeShOf(r.type)) || 'sans code SH';
      const g = parCode.get(code) ?? { types: [], pieces: 0, netG: 0, packKg: 0, chf: 0 };
      g.types.push(libelleOf(r.type) || r.type);
      g.pieces += r.qty;
      g.netG += r.netG;
      g.packKg += r.packagingKg;
      g.chf += r.customs;
      parCode.set(code, g);
    }
    const lignes = [...parCode.entries()]
      .map(([code, g]) => ({
        code,
        types: g.types,
        ...ligne(g.pieces, g.netG / 1000, hasPackaging ? g.netG / 1000 + g.packKg : null, g.chf),
      }))
      .sort((a, b) => b.valeur - a.valeur);

    return { total, lignes };
  }, [computed, summary, grossKg, hasPackaging, codeShOf, libelleOf]);

  /** Types de l'instantané auxquels il manque un libellé ou un code SH. */
  const tarifsManquants = useMemo(
    () => summary.rows
      .filter((r) => !libelleOf(r.type) || !codeShOf(r.type))
      .map((r) => ({ type: r.type, qty: r.qty, libelle: !!libelleOf(r.type), code: !!codeShOf(r.type) })),
    [summary, libelleOf, codeShOf],
  );

  // --- Detail par produit : Avalon, Yggdrasil... ---
  const parProduit = useMemo(() => {
    const rows = new Map<string, {
      titre: string; type: string | null;
      qty: number; netG: number; customs: number; customsEur: number; ret: number;
    }>();
    for (const it of computed.lines) {
      const key = it.product_title;
      const r = rows.get(key) ?? {
        titre: it.product_title, type: it.product_type,
        qty: 0, netG: 0, customs: 0, customsEur: 0, ret: 0,
      };
      r.qty += it.qty_departed;
      r.netG += it.lineWeightGrams;
      r.customs += it.lineCustomsValue;
      r.customsEur += it.lineCustomsEur;
      r.ret += it.qty_returned ?? 0;
      rows.set(key, r);
    }
    return [...rows.values()]
      .map((r) => {
        const vendu = Math.max(0, r.qty - r.ret);
        const unitG = r.qty > 0 ? r.netG / r.qty : 0;
        const unitHt = r.qty > 0 ? r.customs / r.qty : 0;
        return {
          ...r,
          vendu,
          netResteKg: (unitG * r.ret) / 1000,
          valResteChf: unitHt * r.ret,
          valVenduChf: unitHt * vendu,
        };
      })
      .sort((a, b) => (a.type ?? '').localeCompare(b.type ?? '') || a.titre.localeCompare(b.titre));
  }, [computed]);

  const missing = useMemo(() => {
    let weight = 0;
    let rule = 0;
    let price = 0;
    // A l'entree, seul le prix d'achat se declare : un prix de vente absent n'y
    // est pas un defaut. Il ne compte qu'une fois le passage cloture.
    const sansPrix = (i: DeclarationItem) => isClosed && !i.unit_price_eur;
    for (const it of items) {
      if (!it.weight_grams) weight++;
      if (it.unit_cost_textile === null) rule++;
      if (sansPrix(it)) price++;
    }
    const parts: string[] = [];
    if (weight > 0) parts.push(`${weight} sans poids`);
    if (rule > 0) parts.push(`${rule} sans règle de prix`);
    if (price > 0) parts.push(`${price} sans prix de vente`);
    // Recalcule a chaque rendu : le drapeau `incomplete` fige a la creation de
    // l'instantane reste vrai apres correction des donnees, et affichait des
    // lignes en defaut alors que plus rien ne manquait.
    const total = items.filter(
      (i) => !i.weight_grams || i.unit_cost_textile === null || sansPrix(i),
    ).length;
    return { weight, rule, price, total, label: parts.join(' · ') };
  }, [items, isClosed]);

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
              <span>Entrée sur le territoire le {formatDate(passage.departed_on)}</span>
              {passage.returned_on && (
                <>
                  <span className={styles.subSep}>·</span>
                  <span>Retour le {formatDate(passage.returned_on)}</span>
                </>
              )}
              {passage.reference && (
                <>
                  <span className={styles.subSep}>·</span>
                  <span>N° 11.74 : {passage.reference}</span>
                </>
              )}
            </div>
          </div>
        </Group>
      </div>

      <Group gap="xs" className={styles.actions}>
        {/* La feuille de résumé est la seule que la douane demande. Les annexes
            par produit restent disponibles, sans être imposées. */}
        <Button
          variant="light"
          color="slate"
          leftSection={<IconPrinter size={16} />}
          onClick={() => window.open(`/api/customs/passages/${id}/document?only=resume`, '_blank')}
        >
          Imprimer la feuille de résumé
        </Button>
        <Button
          variant="subtle"
          color="slate"
          onClick={() => window.open(`/api/customs/passages/${id}/document`, '_blank')}
        >
          Avec les annexes par produit
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
            {computed.netWeightKg.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            <span className={styles.metricUnit}>kg</span>
          </div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Poids brut</div>
          <div className={styles.metricValue}>
            {grossKg != null
              ? grossKg.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
              : '—'}
            <span className={styles.metricUnit}>kg</span>
          </div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Valeur douanière (prix d&apos;achat)</div>
          <div className={styles.metricValue}>{formatChf(computed.customsValue)}</div>
          <Text size="xs" c="dimmed" mt={4}>{formatEur(computed.customsValueEur)} HT</Text>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>TVA à l&apos;import ({computed.vatPct} %)</div>
          <div className={styles.metricValue}>{formatChf(computed.importVat)}</div>
          <Text size="xs" c="dimmed" mt={4}>
            Estimation de ce que la douane réclamera à l&apos;entrée.
          </Text>
        </div>
      </SimpleGrid>

      {tarifsManquants.length > 0 && (
        <Alert
          color="rust"
          icon={<IconAlertTriangle size={16} />}
          title={`${tarifsManquants.length} type(s) sans libellé ou sans code SH`}
          mb="md"
        >
          <Stack gap={4}>
            {tarifsManquants.map((t) => (
              <Text size="sm" key={t.type}>
                <b>{t.type}</b> — {t.qty} pièce(s) — manque {[!t.libelle && 'le libellé', !t.code && 'le code SH'].filter(Boolean).join(' et ')}
              </Text>
            ))}
            {isClosed ? (
              <Text size="xs" c="dimmed">Passage clôturé : ses valeurs sont figées.</Text>
            ) : (
              <Anchor component={Link} href="/parametres/douane" size="sm" fw={600}>
                Compléter dans Paramètres → Douane
              </Anchor>
            )}
          </Stack>
        </Alert>
      )}

      <Paper className={`${styles.panel} ${styles.panelRecopie}`} radius="md">
        <div className={styles.panelHead}>
          <h3 className={styles.panelTitle}>À recopier sur le 11.74</h3>
        </div>
        <Text size="xs" c="dimmed" mb="sm">
          Case par case, pour la ligne unique du formulaire. Les quatre champs se reprennent
          d&apos;un passage à l&apos;autre ; les six chiffres du dessous se calculent depuis
          l&apos;instantané. Rien de ce cadre ne s&apos;imprime.
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" mb="sm">
          {([
            ['origineDeclaree', "10 · Pays d'origine", 'FR'],
            ['bureauDouane', "15 · Bureau de douane d'apurement", 'Bardonnex'],
            ['designationFormulaire', '17 · Désignation exacte de la marchandise', 'T-shirts et sweatshirts en coton de la marque…'],
            ['tarifFormulaire', '20 · N° de tarif', '6110.2000'],
          ] as const).map(([champ, label, placeholder]) => (
            <div key={champ}>
              <Text size="xs" fw={600} mb={2}>{label}</Text>
              <LabelCell
                initial={form[champ]}
                placeholder={placeholder}
                onCommit={(v) => commitDocField(champ, v)}
              />
            </div>
          ))}
        </SimpleGrid>
        <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }} spacing="xs">
          {([
            ['22 · Masse nette', `${formulaire.total.netKg.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`],
            ['23 · Unités supplémentaires', `${formulaire.total.pieces}`],
            ['24 · Masse brute', formulaire.total.brutKg != null
              ? `${formulaire.total.brutKg.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`
              : '— à compléter'],
            ['25 · Valeur statistique', `${formulaire.total.valeur.toLocaleString('fr-CH')} CHF`],
            ['31 · Valeur TVA', `${formulaire.total.valeur.toLocaleString('fr-CH')} CHF`],
            [`31 · TVA ${computed.vatPct} %`, formatChf(formulaire.total.tva)],
          ] as const).map(([label, value]) => (
            <div key={label} className={styles.metricCard}>
              <div className={styles.metricLabel}>{label}</div>
              <div className={styles.metricValue}>{value}</div>
            </div>
          ))}
        </SimpleGrid>

        {formulaire.lignes.length > 1 && (
          <>
            <Text size="xs" fw={600} mt="md" mb={4}>Si le douanier demande une ligne par code SH</Text>
            <Table withTableBorder striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>20 · Tarif</Table.Th>
                  <Table.Th>Objets</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>22 · Nette</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>23 · Unités</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>24 · Brute</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>25 · Valeur CHF</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>TVA</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {formulaire.lignes.map((l) => (
                  <Table.Tr key={l.code}>
                    <Table.Td>{l.code}</Table.Td>
                    <Table.Td><Text size="xs">{[...new Set(l.types)].join(', ')}</Text></Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{l.netKg.toFixed(1)} kg</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{l.pieces}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{l.brutKg != null ? `${l.brutKg.toFixed(1)} kg` : '—'}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{l.valeur.toLocaleString('fr-CH')}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{formatChf(l.tva)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            <Text size="xs" c="dimmed" mt={4}>
              Chaque ligne est arrondie au franc : leur somme peut s&apos;écarter d&apos;un franc ou deux de la ligne unique.
            </Text>
          </>
        )}

        {materielEnregistre.length > 0 && (
          <div style={{ marginTop: 16, opacity: passage.materiel_imprime ? 1 : 0.45 }}>
            <Text size="xs" fw={600} mb={4}>
              Matériel d&apos;exposition — séparé de la marchandise
              {!passage.materiel_imprime && ' (non imprimé sur la feuille)'}
            </Text>
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
              {([
                ['Objets', `${totauxMat.objets}`],
                ['Poids', `${totauxMat.poidsKg.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`],
                ['Valeur estimée', formatEur(totauxMat.valeurEur)],
                ['Valeur estimée', formatChf(totauxMat.valeurEur * computed.eurToChf)],
              ] as const).map(([label, value], i) => (
                <div key={i} className={styles.metricCard}>
                  <div className={styles.metricLabel}>{label}</div>
                  <div className={styles.metricValue}>{value}</div>
                </div>
              ))}
            </SimpleGrid>
          </div>
        )}

        <Text size="xs" c="dimmed" mt="sm">
          Origine du textile (imprimée sur la feuille de résumé, distincte de la case 10) :
        </Text>
        <div style={{ maxWidth: 120 }}>
          <LabelCell
            initial={form.origin}
            placeholder="BD"
            onCommit={(v) => commitDocField('origin', v)}
          />
        </div>
      </Paper>

      <Paper className={styles.panel} radius="md">
        <div className={styles.panelHead}>
          <h3 className={styles.panelTitle}>Paramètres</h3>
          <span className={styles.savingHint}>{saving ? 'Enregistrement…' : 'Enregistré'}</span>
        </div>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="sm">
          <NumberInput
            label="Taux (1 EUR = ? CHF)"
            value={form.eurToChf}
            onChange={(v) => updateForm({ eurToChf: v })}
            allowedDecimalSeparators={['.', ',']}
            decimalScale={4}
            step={0.01}
            min={0}
          />
          <NumberInput
            label="TVA suisse (%)"
            value={form.vatPct}
            onChange={(v) => updateForm({ vatPct: v })}
            allowedDecimalSeparators={['.', ',']}
            suffix=" %"
            decimalScale={2}
            step={0.1}
            min={0}
          />
          <NumberInput
            label="Poids brut global (kg)"
            description={hasPackaging ? 'Ignoré : les caisses par type font foi.' : 'Utilisé faute de caisses par type.'}
            value={form.grossWeightKg}
            onChange={(v) => updateForm({ grossWeightKg: v })}
            allowedDecimalSeparators={['.', ',']}
            decimalScale={3}
            step={1}
            min={0}
            disabled={hasPackaging}
          />
          <TextInput
            label="N° du 11.74"
            description="Attribué par la douane au guichet."
            value={form.reference}
            onChange={(e) => updateForm({ reference: e.currentTarget.value })}
          />
        </SimpleGrid>

        {/* Le prix de vente ne se déclare pas à l'entrée. Le document du passage
            clôturé s'en sert encore, en attendant la refonte du retour. */}
        {isClosed && productTypes.length > 0 && (
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
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" mb="sm">
          <LabelCell
            initial={form.docTitre}
            placeholder="Titre de la feuille imprimée"
            onCommit={(v) => commitDocField('docTitre', v)}
          />
          <LabelCell
            initial={form.docSousTitre}
            placeholder="Sous-titre"
            onCommit={(v) => commitDocField('docSousTitre', v)}
          />
        </SimpleGrid>
        <Text size="xs" c="dimmed" mb="sm">
          Ces deux champs remplacent le titre par défaut du document imprimé.
          Laissés vides, le titre réglementaire s&apos;affiche.
        </Text>

        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm" mb="sm">
          {([
            ['departedOn', "Date d'entrée sur le territoire (AAAA-MM-JJ)"],
            ['raisonSociale', 'Raison sociale'],
            ['nomPrenom', 'Nom et prénom'],
            ['adresseSiege', 'Adresse du siège social (France)'],
            ['adresseExposition', "Adresse d'exposition"],
            ['dateExposition', "Dates d'exposition"],
            ['dateRetourPrevue', 'Date de retour prévue'],
            ['dateApurement', "Date d'apurement"],
          ] as const).map(([champ, label]) => (
            <div key={champ}>
              <Text size="xs" c="dimmed" mb={2}>{label}</Text>
              <LabelCell
                initial={form[champ]}
                placeholder={label}
                onCommit={(v) => commitDocField(champ, v)}
              />
            </div>
          ))}
        </SimpleGrid>
        <Text size="xs" c="dimmed" mb="sm">
          L&apos;<b>objet</b> et le <b>code SH</b> viennent du référentiel douanier :
          ils se modifient dans <Anchor component={Link} href="/parametres/douane" size="xs">Paramètres → Douane</Anchor>.
          {isClosed
            ? ' Ce passage est clôturé : il garde les valeurs du jour de sa clôture.'
            : ' Ce passage ouvert suit le référentiel en direct.'}
        </Text>
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th colSpan={9} style={{ textAlign: 'center' }}>Départ</Table.Th>
              <Table.Th colSpan={6} style={{ textAlign: 'center', borderLeft: '2px solid var(--mantine-color-gray-4)' }}>
                Retour
              </Table.Th>
            </Table.Tr>
            <Table.Tr>
              <Table.Th style={{ minWidth: 180 }}>Objet (libellé douanier)</Table.Th>
              <Table.Th style={{ minWidth: 110 }}>Code SH</Table.Th>
              <Table.Th>Type Ivy</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Qté de départ</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Poids net</Table.Th>
              <Table.Th style={{ textAlign: 'right', minWidth: 110 }}>Caisses (kg)</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Poids brut</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Valeur douanière HT (EUR)</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Valeur douanière HT (CHF)</Table.Th>
              {/* Toujours affichées : à l'aller elles s'impriment vides, pour être
                  remplies à la main au festival. */}
              {['Qté restante', 'Qté vendue', 'Poids restant (kg)', 'Poids vendu (kg)', 'Valeur restante (CHF)', 'Valeur vendue (CHF)'].map((h) => (
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
                  {libelleOf(r.type) || <Text size="sm" c="rust" fw={600}>à renseigner</Text>}
                </Table.Td>
                <Table.Td>
                  {codeShOf(r.type)
                    ? formatSh(codeShOf(r.type))
                    : <Text size="sm" c="rust" fw={600}>à renseigner</Text>}
                </Table.Td>
                <Table.Td><Text size="xs" c="dimmed">{r.type}</Text></Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{r.qty}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  {(r.netG / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg
                </Table.Td>
                {/* Caisses-fournitures : ni caisses ni brut par type, seulement au total. */}
                <Table.Td style={{ textAlign: 'right' }}>
                  {summary.brutParLigne
                    ? `${r.packagingKg.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`
                    : '—'}
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  {summary.brutParLigne
                    ? `${r.grossKg.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`
                    : '—'}
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{formatEur(r.customsEur)}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{formatChf(r.customs)}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{isClosed ? r.ret : '—'}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{isClosed ? r.vendu : '—'}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{isClosed ? `${r.netResteKg.toFixed(1)} kg` : '—'}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{isClosed ? `${r.netVenduKg.toFixed(1)} kg` : '—'}</Table.Td>
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
                <b>{computed.netWeightKg.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg</b>
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                <b>{summary.totalPackaging.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg</b>
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                <b>{summary.totalGrossKg.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg</b>
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{formatEur(computed.customsValueEur)}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{formatChf(computed.customsValue)}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{isClosed ? summary.totalReste : '—'}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{isClosed ? summary.totalVendu : '—'}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{isClosed ? `${summary.totalNetResteKg.toFixed(1)} kg` : '—'}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{isClosed ? `${summary.totalNetVenduKg.toFixed(1)} kg` : '—'}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{isClosed ? formatChf(summary.totalValResteChf) : '—'}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{isClosed ? formatChf(summary.totalValVenduChf) : '—'}</b></Table.Td>
            </Table.Tr>
          </Table.Tfoot>
        </Table>
        {false && (
          <Alert color="rust" icon={<IconAlertTriangle size={16} />} mt="xs">
            Le poids brut saisi ({computed.grossWeightKg} kg) est <b>inférieur au poids net</b>
            ({computed.netWeightKg.toFixed(1)} kg). Le brut comprend le net plus les caisses :
            il ne peut pas être plus petit. Vérifie ta pesée dans les paramètres.
          </Alert>
        )}
        <h3 className={styles.panelTitle} style={{ marginTop: '1.5rem' }}>Détail par produit</h3>
        <Text size="xs" c="dimmed" mb="xs">
          La même lecture, modèle par modèle. Le poids brut n&apos;y figure pas :
          les caisses se comptent par type, pas par modèle.
        </Text>
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th colSpan={6} style={{ textAlign: 'center' }}>Départ</Table.Th>
              <Table.Th colSpan={5} style={{ textAlign: 'center', borderLeft: '2px solid var(--mantine-color-gray-4)' }}>
                Retour
              </Table.Th>
            </Table.Tr>
            <Table.Tr>
              <Table.Th style={{ minWidth: 200 }}>Produit</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Qté de départ</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Poids net (kg)</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Valeur douanière HT (EUR)</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Valeur douanière HT (CHF)</Table.Th>
              <Table.Th style={{ textAlign: 'right', borderLeft: '2px solid var(--mantine-color-gray-4)' }}>
                Qté restante
              </Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Qté vendue</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Poids restant (kg)</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Valeur restante (CHF)</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Valeur vendue (CHF)</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {parProduit.map((r) => (
              <Table.Tr key={r.titre}>
                <Table.Td>{r.titre}</Table.Td>
                <Table.Td><Text size="xs" c="dimmed">{r.type ?? '—'}</Text></Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{r.qty}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{(r.netG / 1000).toFixed(1)}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{formatEur(r.customsEur)}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{formatChf(r.customs)}</Table.Td>
                <Table.Td style={{ textAlign: 'right', borderLeft: '2px solid var(--mantine-color-gray-4)' }}>
                  {isClosed ? r.ret : '—'}
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{isClosed ? r.vendu : '—'}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{isClosed ? r.netResteKg.toFixed(1) : '—'}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{isClosed ? formatChf(r.valResteChf) : '—'}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{isClosed ? formatChf(r.valVenduChf) : '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr>
              <Table.Td colSpan={2}><b>TOTAL</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{computed.pieces}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{computed.netWeightKg.toFixed(1)}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{formatEur(computed.customsValueEur)}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{formatChf(computed.customsValue)}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right', borderLeft: '2px solid var(--mantine-color-gray-4)' }}>
                <b>{isClosed ? summary.totalReste : '—'}</b>
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{isClosed ? summary.totalVendu : '—'}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{isClosed ? summary.totalNetResteKg.toFixed(1) : '—'}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{isClosed ? formatChf(summary.totalValResteChf) : '—'}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{isClosed ? formatChf(summary.totalValVenduChf) : '—'}</b></Table.Td>
            </Table.Tr>
          </Table.Tfoot>
        </Table>

        <Text size="xs" c="dimmed" mt="xs">
          {summary.caissesSource === 'caisses'
            ? <>Tous les articles sont répartis dans <b>{summary.nombreCaisses} caisse{summary.nombreCaisses > 1 ? 's' : ''}</b>
                {' '}({caissesEnregistrees.map((o) => `${o.quantite} × ${o.designation}`).join(', ')}),
                soit {totauxCaisses.poidsKg.toFixed(1)} kg compris dans le poids brut total. </>
            : 'Le poids brut d\'une ligne vaut son poids net plus celui de ses caisses. '}
          Les caisses sont des fournitures cochées « Caisse » dans{' '}
          <Anchor component={Link} href="/parametres/douane" size="xs">Paramètres → Douane</Anchor>
          {isClosed ? ' ; ce passage clôturé garde celles du jour de sa clôture.' : ', et ce passage ouvert les suit en direct.'}
          {!isClosed && (
            <> Les six dernières colonnes se rempliront <b>toutes seules à la clôture</b>,
            en comparant l&apos;instantané de départ au stock du moment. Elles apparaissent
            dès maintenant pour figurer sur le document d&apos;aller.</>
          )}
        </Text>
      </Paper>

      <Paper className={styles.panel} radius="md">
        <div className={styles.panelHead}>
          <h3 className={styles.panelTitle}>Matériel d&apos;exposition</h3>
          <Checkbox
            label="Imprimer le matériel sur la feuille de résumé"
            checked={passage.materiel_imprime}
            color="moss"
            onChange={(e) => {
              const v = e.currentTarget.checked;
              patchPassage({ materielImprime: v }).catch(() =>
                notifications.show({ title: 'Erreur', message: 'Enregistrement impossible', color: 'red' }));
            }}
          />
        </div>
        <Text size="xs" c="dimmed" mb="sm">
          Le matériel se règle par emplacement dans{' '}
          <Anchor component={Link} href="/parametres/douane" size="xs">Paramètres → Douane</Anchor>
          {isClosed ? ' ; ce passage clôturé garde la liste du jour de sa clôture.' : ', et ce passage ouvert le suit en direct.'}
          {' '}Hors marchandise : il n&apos;entre ni dans les pièces, ni dans la valeur, ni dans la TVA.
          Les fournitures cochées « Caisse » n&apos;y figurent pas : leur poids est dans le poids brut
          (cadre Synthèse), et la case ci-dessus ne les retire pas.
        </Text>
        <Table withTableBorder striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Désignation</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Quantité</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Poids (kg)</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Valeur estimée (€)</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Valeur estimée (CHF)</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {materielEnregistre.map((o, i) => (
              <Table.Tr key={i}>
                <Table.Td>{o.designation}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{o.quantite}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{(o.quantite * o.poids_kg).toFixed(1)}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{formatEur(o.quantite * o.valeur_eur)}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{formatChf(o.quantite * o.valeur_eur * computed.eurToChf)}</Table.Td>
              </Table.Tr>
            ))}
            {materielEnregistre.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text size="sm" c="dimmed" ta="center">Aucun matériel dans le modèle de cet emplacement.</Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
          {materielEnregistre.length > 0 && (
            <Table.Tfoot>
              <Table.Tr>
                <Table.Td><b>TOTAL</b></Table.Td>
                <Table.Td style={{ textAlign: 'right' }}><b>{totauxMat.objets}</b></Table.Td>
                <Table.Td style={{ textAlign: 'right' }}><b>{totauxMat.poidsKg.toFixed(1)}</b></Table.Td>
                <Table.Td style={{ textAlign: 'right' }}><b>{formatEur(totauxMat.valeurEur)}</b></Table.Td>
                <Table.Td style={{ textAlign: 'right' }}><b>{formatChf(totauxMat.valeurEur * computed.eurToChf)}</b></Table.Td>
              </Table.Tr>
            </Table.Tfoot>
          )}
        </Table>
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
                <Table.Th style={{ textAlign: 'right' }}>Valeur douanière (EUR)</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Valeur douanière (CHF)</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>TVA à l&apos;import</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {groups.map((group) => (
                <Fragment key={group.title}>
                  <Table.Tr className={styles.groupRow}>
                    <Table.Td colSpan={9}>{group.title} · {group.totalQty} pièce(s)</Table.Td>
                  </Table.Tr>
                  {group.items.map((it) => (
                    <Table.Tr
                      key={it.id}
                      className={
                        !it.weight_grams || it.unit_cost_textile === null || (isClosed && !it.unit_price_eur)
                          ? styles.incompleteRow
                          : undefined
                      }
                    >
                      <Table.Td>{it.size || '—'}</Table.Td>
                      <Table.Td>{it.color || '—'}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{it.qty_departed}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {it.weight_grams ? `${(it.lineWeightGrams / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg` : '—'}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {it.unit_cost_textile != null ? formatEur(it.unit_cost_textile) : '—'}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {it.unit_cost_print != null ? formatEur(it.unit_cost_print) : '—'}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{formatEur(it.lineCustomsEur)}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{formatChf(it.lineCustomsValue)}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{formatChf(it.lineImportVat)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Fragment>
              ))}
              {groups.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={9}>
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
