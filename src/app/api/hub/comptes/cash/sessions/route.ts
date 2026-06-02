import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, ownsShop, requireUnlock } from '@/lib/hub-ledger/server-auth';

export async function GET(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const shopId = sp.get('shopId');
  if (!shopId || !ownsShop(res.auth, shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  const { data: sessions, error } = await res.auth.svc
    .from('hub_ledger_cash_sessions')
    .select('*, hub_ledger_cash_outflows(amount)')
    .eq('shop_id', shopId)
    .order('opened_on', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const withBalance = (sessions ?? []).map((s: any) => {
    const out = (s.hub_ledger_cash_outflows ?? []).reduce((acc: number, o: any) => acc + Number(o.amount), 0);
    const { hub_ledger_cash_outflows, ...rest } = s;
    return { ...rest, total_outflows: out, balance: Number(s.opening_float) - out };
  });
  return NextResponse.json({ sessions: withBalance });
}

export async function POST(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const b = await request.json().catch(() => null);
  if (!b?.shopId || !ownsShop(res.auth, b.shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  if (typeof b.openingFloat !== 'number' || b.openingFloat < 0 || !b.openedOn) {
    return NextResponse.json({ error: 'Champs invalides' }, { status: 400 });
  }

  const { data, error } = await res.auth.svc.from('hub_ledger_cash_sessions').insert({
    shop_id: b.shopId,
    location_id: b.locationId ?? null,
    study_zone_id: b.studyZoneId ?? null,
    opening_float: b.openingFloat,
    opened_on: b.openedOn,
    created_by_user_id: res.auth.userId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}

export async function PATCH(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const b = await request.json().catch(() => null);
  if (!b?.id || !b?.shopId || !ownsShop(res.auth, b.shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (b.openingFloat !== undefined) patch.opening_float = b.openingFloat;
  if (b.openedOn !== undefined) patch.opened_on = b.openedOn;
  if (b.studyZoneId !== undefined) patch.study_zone_id = b.studyZoneId;
  if (b.locationId !== undefined) patch.location_id = b.locationId;

  const { data, error } = await res.auth.svc
    .from('hub_ledger_cash_sessions')
    .update(patch)
    .eq('id', b.id)
    .eq('shop_id', b.shopId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}
