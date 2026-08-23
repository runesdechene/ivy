import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renderProforma, type ProformaPassage, type ProformaItem } from '@/lib/customs/render-proforma';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * L1 — Facture proforma d'importation, en 3 exemplaires.
 *
 * Lecture seule, rendue depuis l'instantané figé. Les contrôles bloquants
 * (A4 position tarifaire / origine, A6 taux de change, A2 délai dépassé)
 * apparaissent en tête du document plutôt que d'empêcher sa génération :
 * mieux vaut un brouillon annoté qu'aucun document à 6 h du matin.
 *
 * GET /api/customs/passages/<id>/proforma
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const { data: passage, error } = await supabase
    .from('customs_declarations')
    .select('location_name, reference, numero_decision, bureau_douane, lieu_vente, departed_on, date_expiration, eur_to_chf, frais_transport_chf, methode_repartition, regime_valeur, surete_deposee_chf, origin, customs_labels, tariff_by_type')
    .eq('id', id)
    .maybeSingle();

  if (error || !passage) {
    return NextResponse.json({ error: 'Passage introuvable' }, { status: 404 });
  }

  const items: ProformaItem[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: itErr } = await supabase
      .from('customs_declaration_items')
      .select('product_title, product_type, size, color, qty_departed, weight_grams, unit_cost_textile, unit_cost_print')
      .eq('declaration_id', id)
      .order('id')
      .range(from, from + 999);
    if (itErr) {
      console.error('GET proforma (items):', itErr);
      return NextResponse.json({ error: "Lecture de l'instantané impossible" }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    items.push(...(data as ProformaItem[]));
    if (data.length < 1000) break;
  }

  if (items.length === 0) {
    return NextResponse.json({ error: 'Ce passage ne contient aucune ligne' }, { status: 400 });
  }

  const html = renderProforma(passage as ProformaPassage, items);

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
