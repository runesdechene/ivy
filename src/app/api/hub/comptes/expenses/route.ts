import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, ownsShop, requireUnlock } from '@/lib/hub-ledger/server-auth';

const STATUSES = ['engage', 'soumis', 'rembourse'];

export async function GET(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const shopId = sp.get('shopId');
  if (!shopId || !ownsShop(res.auth, shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  let q = res.auth.svc.from('hub_ledger_expenses').select('*').eq('shop_id', shopId);
  const studyZoneId = sp.get('studyZoneId');
  if (studyZoneId) q = q.eq('study_zone_id', studyZoneId);
  const { data, error } = await q.order('spent_on', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ expenses: data });
}

export async function POST(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const b = await request.json().catch(() => null);
  if (!b?.shopId || !ownsShop(res.auth, b.shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  if (typeof b.amount !== 'number' || b.amount < 0 || !b.spentOn) {
    return NextResponse.json({ error: 'Champs invalides' }, { status: 400 });
  }

  const { data, error } = await res.auth.svc.from('hub_ledger_expenses').insert({
    shop_id: b.shopId,
    location_id: b.locationId ?? null,
    study_zone_id: b.studyZoneId ?? null,
    spent_on: b.spentOn,
    description: b.description ?? '',
    amount: b.amount,
    receipt_path: b.receiptPath ?? null,
    status: 'engage',
    created_by_user_id: res.auth.userId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ expense: data });
}

export async function PATCH(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const b = await request.json().catch(() => null);
  if (!b?.id || !b?.shopId || !ownsShop(res.auth, b.shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  if (b.status && !STATUSES.includes(b.status)) return NextResponse.json({ error: 'Statut invalide' }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ['description', 'amount', 'status', 'receipt_path', 'spent_on', 'location_id', 'study_zone_id'] as const) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (b[camel] !== undefined) patch[k] = b[camel];
  }

  const { data, error } = await res.auth.svc
    .from('hub_ledger_expenses')
    .update(patch)
    .eq('id', b.id)
    .eq('shop_id', b.shopId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ expense: data });
}

export async function DELETE(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const id = sp.get('id');
  const shopId = sp.get('shopId');
  if (!id || !shopId || !ownsShop(res.auth, shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  const { error } = await res.auth.svc.from('hub_ledger_expenses').delete().eq('id', id).eq('shop_id', shopId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
