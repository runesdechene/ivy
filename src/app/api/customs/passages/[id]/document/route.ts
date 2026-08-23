import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renderPassage, type PassageRow, type PassageItem } from '@/lib/customs/render-passage';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * Document imprimable d'un passage en douane.
 *
 * Tout vient de l'instantané FIGÉ : le document reflète ce qui a passé la
 * frontière, pas le stock d'aujourd'hui. Lecture seule.
 *
 * GET /api/customs/passages/<id>/document
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  // ?only=resume : la feuille de synthese seule, sans le detail par produit.
  const onlySummary = request.nextUrl.searchParams.get('only') === 'resume';

  const { data: passage, error } = await supabase
    .from('customs_declarations')
    .select('shop_id, location_name, status, reference, departed_on, returned_on, eur_to_chf, vat_pct, gross_weight_kg, origin, prices_chf_ttc, customs_labels, packaging_kg, doc_titre, doc_sous_titre, raison_sociale, nom_prenom, adresse_siege, adresse_exposition, date_exposition, date_retour_prevue, date_apurement, tariff_by_type')
    .eq('id', id)
    .maybeSingle();

  if (error || !passage) {
    return NextResponse.json({ error: 'Passage introuvable' }, { status: 404 });
  }

  const items: PassageItem[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: itErr } = await supabase
      .from('customs_declaration_items')
      .select('product_title, product_type, image_url, size, color, qty_departed, qty_returned, qty_sold_recorded, weight_grams, unit_cost_textile, unit_cost_print, unit_price_eur, incomplete')
      .eq('declaration_id', id)
      .order('id')
      .range(from, from + 999);
    if (itErr) {
      console.error('GET document (items):', itErr);
      return NextResponse.json({ error: "Lecture de l'instantané impossible" }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    items.push(...(data as PassageItem[]));
    if (data.length < 1000) break;
  }

  if (items.length === 0) {
    return NextResponse.json({ error: 'Ce passage ne contient aucune ligne' }, { status: 400 });
  }

  const html = renderPassage(passage as PassageRow, items, { onlySummary });

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
