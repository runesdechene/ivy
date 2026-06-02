import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, requireUnlock } from '@/lib/hub-ledger/server-auth';

async function sessionShopOk(res: { auth: { svc: any; shopIds: string[] } }, sessionId: string): Promise<boolean> {
  const { data } = await res.auth.svc.from('hub_ledger_cash_sessions').select('shop_id').eq('id', sessionId).maybeSingle();
  return !!data && res.auth.shopIds.includes(data.shop_id);
}

export async function GET(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const sessionId = new URL(request.url).searchParams.get('sessionId');
  if (!sessionId || !(await sessionShopOk(res, sessionId))) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  const { data, error } = await res.auth.svc
    .from('hub_ledger_cash_outflows')
    .select('*')
    .eq('session_id', sessionId)
    .order('spent_on', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ outflows: data });
}

export async function POST(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const b = await request.json().catch(() => null);
  if (!b?.sessionId || !(await sessionShopOk(res, b.sessionId))) return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  if (typeof b.amount !== 'number' || b.amount < 0 || !b.spentOn) return NextResponse.json({ error: 'Champs invalides' }, { status: 400 });

  const { data, error } = await res.auth.svc.from('hub_ledger_cash_outflows').insert({
    session_id: b.sessionId,
    spent_on: b.spentOn,
    description: b.description ?? '',
    amount: b.amount,
    created_by_user_id: res.auth.userId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ outflow: data });
}

export async function DELETE(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const id = sp.get('id');
  const sessionId = sp.get('sessionId');
  if (!id || !sessionId || !(await sessionShopOk(res, sessionId))) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  const { error } = await res.auth.svc.from('hub_ledger_cash_outflows').delete().eq('id', id).eq('session_id', sessionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
