import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildSnapshot } from '@/lib/customs/snapshot';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** GET /api/customs/passages?shopId= — liste des passages, le plus récent d'abord. */
export async function GET(request: NextRequest) {
  const shopId = request.nextUrl.searchParams.get('shopId');
  if (!shopId) return NextResponse.json({ error: 'shopId requis' }, { status: 400 });

  const { data, error } = await supabase
    .from('customs_declarations')
    .select('id, location_id, location_name, status, reference, departed_on, returned_on, eur_to_chf, vat_pct, gross_weight_kg, created_at')
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('GET /api/customs/passages:', error);
    return NextResponse.json({ error: 'Lecture impossible' }, { status: 500 });
  }

  // Nombre de pièces par passage, pour la liste
  const ids = (data ?? []).map(d => d.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: items } = await supabase
      .from('customs_declaration_items')
      .select('declaration_id, qty_departed')
      .in('declaration_id', ids);
    for (const it of (items ?? []) as { declaration_id: string; qty_departed: number }[]) {
      counts.set(it.declaration_id, (counts.get(it.declaration_id) ?? 0) + it.qty_departed);
    }
  }

  return NextResponse.json({
    passages: (data ?? []).map(d => ({ ...d, total_pieces: counts.get(d.id) ?? 0 })),
  });
}

/**
 * POST /api/customs/passages — ouvre un passage et FIGE l'instantané de départ.
 *
 * body: { shopId, locationId, locationName, eurToChf, vatPct?, grossWeightKg?,
 *         reference?, origin?, pricesChfTtc? }
 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    shopId?: string;
    locationId?: string;
    locationName?: string;
    eurToChf?: number;
    vatPct?: number;
    grossWeightKg?: number | null;
    reference?: string;
    origin?: string;
    pricesChfTtc?: Record<string, number>;
  };

  const { shopId, locationId, locationName, eurToChf } = body;
  if (!shopId || !locationId || !locationName) {
    return NextResponse.json({ error: 'shopId, locationId et locationName requis' }, { status: 400 });
  }
  if (!eurToChf || eurToChf <= 0) {
    return NextResponse.json({ error: 'Le taux EUR vers CHF est obligatoire' }, { status: 400 });
  }

  // Un seul passage ouvert par emplacement : sinon deux instantanés se marchent dessus.
  const { data: already } = await supabase
    .from('customs_declarations')
    .select('id, departed_on')
    .eq('shop_id', shopId)
    .eq('location_id', locationId)
    .eq('status', 'open')
    .maybeSingle();

  if (already) {
    return NextResponse.json(
      {
        error: 'Un passage est déjà ouvert sur cet emplacement',
        openPassageId: already.id,
        departedOn: already.departed_on,
      },
      { status: 409 },
    );
  }

  const items = await buildSnapshot(supabase, shopId, locationId);
  if (items.length === 0) {
    return NextResponse.json({ error: 'Aucun stock à cet emplacement' }, { status: 400 });
  }

  const { data: passage, error } = await supabase
    .from('customs_declarations')
    .insert({
      shop_id: shopId,
      location_id: locationId,
      location_name: locationName,
      eur_to_chf: eurToChf,
      vat_pct: body.vatPct ?? 8.1,
      gross_weight_kg: body.grossWeightKg ?? null,
      reference: body.reference ?? null,
      origin: body.origin || 'BD',
      prices_chf_ttc: body.pricesChfTtc ?? {},
    })
    .select('id')
    .single();

  if (error || !passage) {
    console.error('POST /api/customs/passages:', error);
    return NextResponse.json({ error: "Création impossible" }, { status: 500 });
  }

  // L'instantané, par lots : il peut compter plusieurs centaines de lignes.
  for (let i = 0; i < items.length; i += 400) {
    const batch = items.slice(i, i + 400).map(it => ({ ...it, declaration_id: passage.id }));
    const { error: insErr } = await supabase.from('customs_declaration_items').insert(batch);
    if (insErr) {
      // L'instantané doit être complet ou inexistant : un passage à moitié figé
      // serait pire que pas de passage du tout.
      await supabase.from('customs_declarations').delete().eq('id', passage.id);
      console.error('POST /api/customs/passages (items):', insErr);
      return NextResponse.json({ error: "L'instantané n'a pas pu être enregistré" }, { status: 500 });
    }
  }

  return NextResponse.json({
    id: passage.id,
    lines: items.length,
    pieces: items.reduce((s, i) => s + i.qty_departed, 0),
  });
}
