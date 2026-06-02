import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, ownsShop, requireUnlock } from '@/lib/hub-ledger/server-auth';

export async function GET(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const shopId = new URL(request.url).searchParams.get('shopId');
  if (!shopId || !ownsShop(res.auth, shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  const { data, error } = await res.auth.svc
    .from('hub_ledger_cash_movements')
    .select('*')
    .eq('shop_id', shopId)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const movements = data ?? [];
  const balance = movements.reduce((acc: number, m: { amount: number }) => acc + Number(m.amount), 0);
  return NextResponse.json({ balance, movements });
}

export async function POST(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const b = await request.json().catch(() => null);
  if (!b?.shopId || !ownsShop(res.auth, b.shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  if (typeof b.amount !== 'number' || b.amount === 0 || Number.isNaN(b.amount) || !b.occurredOn) {
    return NextResponse.json({ error: 'Montant ou date invalide' }, { status: 400 });
  }

  const { data, error } = await res.auth.svc.from('hub_ledger_cash_movements').insert({
    shop_id: b.shopId,
    occurred_on: b.occurredOn,
    amount: b.amount,
    justification: b.justification ?? '',
    created_by_user_id: res.auth.userId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ movement: data });
}

export async function DELETE(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const id = sp.get('id');
  const shopId = sp.get('shopId');
  if (!id || !shopId || !ownsShop(res.auth, shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  const { error } = await res.auth.svc.from('hub_ledger_cash_movements').delete().eq('id', id).eq('shop_id', shopId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
