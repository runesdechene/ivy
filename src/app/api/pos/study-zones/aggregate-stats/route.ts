import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { aggregateMovements, type MovementRow } from '../_lib/aggregate';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get('shopId');
  const locationIdsParam = searchParams.get('locationIds');

  if (!shopId) {
    return NextResponse.json({ error: 'Missing shopId' }, { status: 400 });
  }

  const emptyResult = { ...aggregateMovements([]), zonesCount: 0, locationsCount: 0 };

  // 1. Toutes les zones du shop
  const { data: zones, error: zonesError } = await supabase
    .from('pos_study_zones')
    .select('date_from, date_to')
    .eq('shop_id', shopId);

  if (zonesError) {
    return NextResponse.json({ error: zonesError.message }, { status: 500 });
  }
  if (!zones || zones.length === 0) {
    return NextResponse.json(emptyResult);
  }

  // 2. Fenêtre globale
  const from = zones.reduce((min, z) => (z.date_from < min ? z.date_from : min), zones[0].date_from);
  const to = zones.reduce((max, z) => (z.date_to > max ? z.date_to : max), zones[0].date_to);

  // 3. Résolution des location IDs Shopify -> UUID
  const requestedIds = (locationIdsParam || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  let resolvedLocationIds: string[] = [];
  if (requestedIds.length > 0) {
    resolvedLocationIds = requestedIds.filter(id => UUID_RE.test(id));
    const toResolve = requestedIds.filter(id => !UUID_RE.test(id));
    if (toResolve.length > 0) {
      const { data: locs } = await supabase
        .from('locations')
        .select('id')
        .eq('shop_id', shopId)
        .in('shopify_id', toResolve);
      if (locs) resolvedLocationIds.push(...locs.map(l => l.id));
    }
  }

  // 4. Une seule requête mouvements sur la fenêtre globale
  let query = supabase
    .from('stock_movements')
    .select('variant_id, product_title, variant_title, quantity, moved_on')
    .eq('shop_id', shopId)
    .gte('moved_on', from)
    .lte('moved_on', to);

  if (resolvedLocationIds.length > 0) {
    query = query.in('location_id', resolvedLocationIds);
  }

  const { data: movements, error: movementsError } = await query;
  if (movementsError) {
    return NextResponse.json({ error: movementsError.message }, { status: 500 });
  }

  // 5. Garder uniquement les mouvements dans au moins une plage de zone
  const ranges = zones.map(z => ({ from: z.date_from, to: z.date_to }));
  const filtered = ((movements as MovementRow[]) || []).filter(m =>
    ranges.some(r => m.moved_on >= r.from && m.moved_on <= r.to)
  );

  // 6. Agrégation
  const aggregate = aggregateMovements(filtered);

  return NextResponse.json({
    ...aggregate,
    zonesCount: zones.length,
    locationsCount: resolvedLocationIds.length,
  });
}
