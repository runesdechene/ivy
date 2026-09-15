import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renderVentes, type PassageVentes } from '@/lib/customs/render-ventes';
import type { Reconstitution } from '@/lib/customs/reconstitution';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** GET /api/customs/passages/<id>/ventes[?prixMoyen=1] — liste imprimable des ventes reconstituées. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { data: passage } = await supabase
    .from('customs_declarations')
    .select('location_name, doc_titre, departed_on, returned_on, date_exposition, eur_to_chf, vat_pct, customs_labels, reconstitution')
    .eq('id', id)
    .maybeSingle();
  if (!passage) return NextResponse.json({ error: 'Passage introuvable' }, { status: 404 });
  if (!passage.reconstitution) {
    return NextResponse.json({ error: "Aucune vente reconstituée pour ce passage" }, { status: 404 });
  }
  const html = renderVentes(passage as PassageVentes, passage.reconstitution as Reconstitution, {
    prixMoyen: request.nextUrl.searchParams.get('prixMoyen') === '1',
  });
  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
