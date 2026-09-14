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
 * body: { shopId, locationId, locationName, eurToChf, departedOn?, vatPct?,
 *         grossWeightKg?, reference?, origin? }
 *
 * Aucun prix de vente à l'entrée : seul le prix d'achat se déclare sur le 11.74.
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
    departedOn?: string;
  };

  const { shopId, locationId, locationName, eurToChf } = body;
  if (!shopId || !locationId || !locationName) {
    return NextResponse.json({ error: 'shopId, locationId et locationName requis' }, { status: 400 });
  }
  if (!eurToChf || eurToChf <= 0) {
    return NextResponse.json({ error: 'Le taux EUR vers CHF est obligatoire' }, { status: 400 });
  }
  // Date d'entrée prévue sur le territoire : souvent différente du jour où l'on
  // fige le stock (on charge la veille, on passe la frontière le lendemain).
  if (body.departedOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(body.departedOn)) {
    return NextResponse.json({ error: "Date d'entrée invalide (AAAA-MM-JJ)" }, { status: 400 });
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

  const { items, archivesExclus } = await buildSnapshot(supabase, shopId, locationId);
  if (items.length === 0) {
    return NextResponse.json({ error: 'Aucun stock à cet emplacement' }, { status: 400 });
  }

  // Ce qui ne change pas d'un voyage a l'autre se reprend du passage precedent :
  // identite, caisses, cases fixes du 11.74. Sans ca, tout etait a ressaisir le
  // jour du passage, au guichet. Ce qui est propre au voyage (dates, titre du
  // festival, adresse d'exposition, n° 11.74) repart vide. Les libelles et codes
  // SH, eux, viennent du referentiel douanier (Parametres → Douane).
  const { data: previous } = await supabase
    .from('customs_declarations')
    .select('vat_pct, origin, origine_declaree, packaging_kg, doc_sous_titre, raison_sociale, nom_prenom, adresse_siege, bureau_douane, regime_valeur, methode_repartition, designation_formulaire, tarif_formulaire')
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Des cles mal encodees (« Le Zipp� ») trainent dans d'anciens libelles : on
  // ne les propage pas.
  const sansCorruption = <T,>(obj: Record<string, T> | null | undefined): Record<string, T> =>
    Object.fromEntries(Object.entries(obj ?? {}).filter(([k]) => !k.includes('\uFFFD')));

  const { data: passage, error } = await supabase
    .from('customs_declarations')
    .insert({
      shop_id: shopId,
      location_id: locationId,
      location_name: locationName,
      eur_to_chf: eurToChf,
      // A defaut, la colonne prend la date du jour.
      ...(body.departedOn ? { departed_on: body.departedOn } : {}),
      vat_pct: body.vatPct ?? previous?.vat_pct ?? 8.1,
      gross_weight_kg: body.grossWeightKg ?? null,
      reference: body.reference ?? null,
      origin: body.origin || previous?.origin || 'BD',
      origine_declaree: previous?.origine_declaree || 'FR',
      prices_chf_ttc: {},
      packaging_kg: sansCorruption(previous?.packaging_kg as Record<string, number> | null),
      doc_sous_titre: previous?.doc_sous_titre ?? null,
      raison_sociale: previous?.raison_sociale ?? null,
      nom_prenom: previous?.nom_prenom ?? null,
      adresse_siege: previous?.adresse_siege ?? null,
      bureau_douane: previous?.bureau_douane ?? null,
      regime_valeur: previous?.regime_valeur ?? 'NEGOCE',
      methode_repartition: previous?.methode_repartition ?? 'VALEUR',
      designation_formulaire: previous?.designation_formulaire ?? null,
      tarif_formulaire: previous?.tarif_formulaire ?? null,
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
    // Ecartes de l'instantane, mais jamais en silence : l'ecran les affiche.
    archivesExclus,
  });
}
