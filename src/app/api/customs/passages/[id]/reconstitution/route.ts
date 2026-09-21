import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { lireRapportSumUp, type PaiementSumUp } from '@/lib/customs/sumup';
import {
  ErreurReconstitution, piecesVenduesDuPassage, reconstituer, syntheseParType,
} from '@/lib/customs/reconstitution';
import { loadReferentiel, prixDuReferentiel } from '@/lib/customs/tariffs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * Ventes reconstituées d'un passage clôturé.
 *
 * POST (multipart) : `fichier` (rapport SumUp .xlsx, facultatif si espèces seules),
 * `especesChf`, `especesEur`, `offertes` (JSON { type: nombre }, facultatif).
 * Calcule la répartition et la FIGE sur le passage, avec
 * ses entrées : la liste ne bouge plus tant qu'on ne relance pas.
 * DELETE : efface la reconstitution.
 *
 * Rien n'est écrit dans le stock : Ivy n'est pas une caisse.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const { data: passage } = await supabase
    .from('customs_declarations')
    .select('id, shop_id, status, eur_to_chf, vat_pct')
    .eq('id', id)
    .maybeSingle();
  if (!passage) return NextResponse.json({ error: 'Passage introuvable' }, { status: 404 });
  if (passage.status !== 'closed') {
    return NextResponse.json({ error: 'Clôture le passage avant de reconstituer les ventes : il faut savoir ce qui est revenu.' }, { status: 409 });
  }

  const form = await request.formData();
  const montant = (cle: string) => {
    const brut = String(form.get(cle) ?? '').trim().replace(',', '.');
    const n = brut === '' ? 0 : Number(brut);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
  };
  const especesChf = montant('especesChf');
  const especesEur = montant('especesEur');
  if (Number.isNaN(especesChf) || Number.isNaN(especesEur)) {
    return NextResponse.json({ error: 'Montant des espèces invalide' }, { status: 400 });
  }

  // Pièces offertes saisies par le déclarant, par type.
  const offertes: Record<string, number> = {};
  const brutOffertes = String(form.get('offertes') ?? '').trim();
  if (brutOffertes) {
    let lu: unknown;
    try { lu = JSON.parse(brutOffertes); } catch { lu = null; }
    if (!lu || typeof lu !== 'object') {
      return NextResponse.json({ error: 'Pièces offertes illisibles' }, { status: 400 });
    }
    for (const [type, v] of Object.entries(lu as Record<string, unknown>)) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        return NextResponse.json({ error: `Nombre de pièces offertes invalide pour ${type}` }, { status: 400 });
      }
      if (n > 0) offertes[type] = n;
    }
  }

  let paiements: PaiementSumUp[] = [];
  const fichier = form.get('fichier');
  if (fichier instanceof File && fichier.size > 0) {
    try {
      const rapport = lireRapportSumUp(new Uint8Array(await fichier.arrayBuffer()));
      if (rapport.devise !== 'EUR') {
        return NextResponse.json({ error: `Rapport SumUp en ${rapport.devise} : seuls les rapports en euros sont pris en charge.` }, { status: 400 });
      }
      paiements = rapport.paiements;
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Rapport SumUp illisible' }, { status: 400 });
    }
  }

  // Lignes figées du passage.
  const items: Parameters<typeof piecesVenduesDuPassage>[0] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('customs_declaration_items')
      .select('product_title, product_type, size, color, qty_departed, qty_returned, unit_cost_textile, unit_cost_print')
      .eq('declaration_id', id)
      .order('id')
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: "Lecture de l'instantané impossible" }, { status: 500 });
    items.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  try {
    const prix = prixDuReferentiel(await loadReferentiel(supabase, passage.shop_id));
    const reconstitution = reconstituer({
      pieces: piecesVenduesDuPassage(items),
      paiements, especesChf, especesEur, offertes,
      taux: Number(passage.eur_to_chf),
      prix,
    });
    const { error } = await supabase
      .from('customs_declarations')
      .update({ reconstitution, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('POST reconstitution (enregistrement):', error);
      return NextResponse.json({ error: 'Enregistrement impossible' }, { status: 500 });
    }
    return NextResponse.json({ reconstitution, synthese: syntheseParType(reconstitution, Number(passage.vat_pct)) });
  } catch (err) {
    if (err instanceof ErreurReconstitution) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error('POST reconstitution:', err);
    return NextResponse.json({ error: 'Reconstitution impossible' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { error } = await supabase
    .from('customs_declarations')
    .update({ reconstitution: null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return NextResponse.json({ error: 'Suppression impossible' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
