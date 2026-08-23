import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildSnapshot } from '@/lib/customs/snapshot';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** GET — le passage et son instantané. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const { data: passage, error } = await supabase
    .from('customs_declarations')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !passage) return NextResponse.json({ error: 'Passage introuvable' }, { status: 404 });

  const items: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from('customs_declaration_items')
      .select('*')
      .eq('declaration_id', id)
      .order('id')
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    items.push(...data);
    if (data.length < 1000) break;
  }

  return NextResponse.json({ passage, items });
}

/**
 * PATCH — modifie les paramètres du passage (taux, TVA, poids brut, prix par
 * type, référence). L'instantané, lui, ne bouge JAMAIS : c'est ce qui a
 * réellement passé la frontière.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json()) as Record<string, unknown>;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.eurToChf === 'number' && body.eurToChf > 0) patch.eur_to_chf = body.eurToChf;
  if (typeof body.vatPct === 'number' && body.vatPct >= 0) patch.vat_pct = body.vatPct;
  if (body.grossWeightKg === null || typeof body.grossWeightKg === 'number') patch.gross_weight_kg = body.grossWeightKg;
  if (typeof body.reference === 'string') patch.reference = body.reference;
  if (typeof body.origin === 'string' && body.origin) patch.origin = body.origin;
  if (typeof body.departedOn === 'string') patch.departed_on = body.departedOn;
  if (body.customsLabels && typeof body.customsLabels === 'object') {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.customsLabels as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) clean[k] = v.trim();
    }
    patch.customs_labels = clean;
  }
  // Champs legaux de l'admission temporaire (spec « Vente incertaine Suisse »)
  for (const [key, col] of [
    ['numeroDecision', 'numero_decision'],
    ['bureauDouane', 'bureau_douane'],
    ['lieuVente', 'lieu_vente'],
  ] as const) {
    if (typeof body[key] === 'string') patch[col] = body[key];
  }
  if (typeof body.dateExpiration === 'string' || body.dateExpiration === null) {
    patch.date_expiration = body.dateExpiration;
  }
  for (const [key, col] of [
    ['fraisTransportChf', 'frais_transport_chf'],
    ['sureteDeposeeChf', 'surete_deposee_chf'],
  ] as const) {
    if (typeof body[key] === 'number' && body[key] >= 0) patch[col] = body[key];
    else if (body[key] === null) patch[col] = null;
  }
  if (body.methodeRepartition === 'VALEUR' || body.methodeRepartition === 'POIDS') {
    patch.methode_repartition = body.methodeRepartition;
  }
  if (body.regimeValeur === 'NEGOCE' || body.regimeValeur === 'PRODUCTION_PROPRE') {
    patch.regime_valeur = body.regimeValeur;
  }
  if (body.tariffByType && typeof body.tariffByType === 'object') {
    const clean: Record<string, { position?: string; origine?: string; tva?: number }> = {};
    for (const [type, raw] of Object.entries(body.tariffByType as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const entry: { position?: string; origine?: string; tva?: number } = {};
      if (typeof r.position === 'string' && r.position.trim()) entry.position = r.position.trim();
      if (typeof r.origine === 'string' && r.origine.trim()) entry.origine = r.origine.trim().toUpperCase();
      const tva = Number(r.tva);
      if (Number.isFinite(tva) && tva > 0) entry.tva = tva;
      clean[type] = entry;
    }
    patch.tariff_by_type = clean;
  }
  if (body.packagingKg && typeof body.packagingKg === 'object') {
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(body.packagingKg as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) clean[k] = n;
    }
    patch.packaging_kg = clean;
  }
  if (body.pricesChfTtc && typeof body.pricesChfTtc === 'object') {
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(body.pricesChfTtc as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) clean[k] = n;
    }
    patch.prices_chf_ttc = clean;
  }

  const { data, error } = await supabase
    .from('customs_declarations')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    console.error('PATCH /api/customs/passages/[id]:', error);
    return NextResponse.json({ error: 'Enregistrement impossible' }, { status: 500 });
  }
  return NextResponse.json({ passage: data });
}

/**
 * POST — clôture le passage : fige l'instantané de RETOUR et calcule la
 * réconciliation.
 *
 * Trois chiffres par ligne : parti, revenu, et vendu selon la caisse. Quand
 * `parti − revenu ≠ vendu`, l'écart est réel (casse, cadeau, pièce oubliée) :
 * on l'affiche plutôt que de le masquer.
 */
export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const { data: passage } = await supabase
    .from('customs_declarations')
    .select('id, shop_id, location_id, status, departed_on')
    .eq('id', id)
    .maybeSingle();

  if (!passage) return NextResponse.json({ error: 'Passage introuvable' }, { status: 404 });
  if (passage.status === 'closed') {
    return NextResponse.json({ error: 'Ce passage est déjà clôturé' }, { status: 409 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const { items: current } = await buildSnapshot(supabase, passage.shop_id, passage.location_id);
  const backByVariant = new Map(current.map(i => [i.variant_id, i.qty_departed]));

  // Ventes enregistrées au stand sur la période, depuis stock_movements.
  // La colonne location_id y est un UUID, pas l'ID Shopify.
  const { data: loc } = await supabase
    .from('locations')
    .select('id')
    .eq('shop_id', passage.shop_id)
    .eq('shopify_id', passage.location_id)
    .maybeSingle();

  const soldByVariant = new Map<string, number>();
  if (loc) {
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from('stock_movements')
        .select('variant_id, quantity')
        .eq('shop_id', passage.shop_id)
        .eq('location_id', loc.id)
        .gte('moved_on', passage.departed_on)
        .lte('moved_on', today)
        .order('id')
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      for (const m of data as { variant_id: string; quantity: number }[]) {
        if (m.quantity < 0) soldByVariant.set(m.variant_id, (soldByVariant.get(m.variant_id) ?? 0) + Math.abs(m.quantity));
      }
      if (data.length < 1000) break;
    }
  }

  const items: { id: string; variant_id: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from('customs_declaration_items')
      .select('id, variant_id')
      .eq('declaration_id', id)
      .order('id')
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    items.push(...(data as { id: string; variant_id: string | null }[]));
    if (data.length < 1000) break;
  }

  for (const it of items) {
    const returned = it.variant_id ? backByVariant.get(it.variant_id) ?? 0 : 0;
    const sold = it.variant_id ? soldByVariant.get(it.variant_id) ?? 0 : 0;
    const { error } = await supabase
      .from('customs_declaration_items')
      .update({ qty_returned: returned, qty_sold_recorded: sold })
      .eq('id', it.id);
    if (error) {
      console.error('clôture, ligne', it.id, error);
      return NextResponse.json({ error: 'La clôture a échoué en cours de route' }, { status: 500 });
    }
  }

  const { error: closeErr } = await supabase
    .from('customs_declarations')
    .update({
      status: 'closed',
      returned_on: today,
      return_snapshot_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (closeErr) {
    console.error('POST clôture:', closeErr);
    return NextResponse.json({ error: 'Clôture impossible' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, lines: items.length });
}
