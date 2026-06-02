import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, ownsShop } from '@/lib/hub-ledger/server-auth';
import { hashPin, verifyPin } from '@/lib/hub-ledger/pin';
import { issueUnlockToken } from '@/lib/hub-ledger/unlock-token';

export async function GET(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  const shopId = new URL(request.url).searchParams.get('shopId');
  if (!shopId || !ownsShop(res.auth, shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  const { data } = await res.auth.svc
    .from('hub_ledger_settings')
    .select('pin_hash')
    .eq('shop_id', shopId)
    .maybeSingle();

  return NextResponse.json({ pinSet: !!data?.pin_hash });
}

export async function POST(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  const { shopId, action, pin } = body as { shopId?: string; action?: string; pin?: string };

  if (!shopId || !ownsShop(res.auth, shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  if (!pin || !/^\d{4,6}$/.test(pin)) return NextResponse.json({ error: 'PIN invalide (4 à 6 chiffres)' }, { status: 400 });

  const { svc, userId } = res.auth;
  const { data: settings } = await svc
    .from('hub_ledger_settings')
    .select('pin_hash')
    .eq('shop_id', shopId)
    .maybeSingle();

  if (action === 'setup') {
    if (settings?.pin_hash) return NextResponse.json({ error: 'PIN déjà défini' }, { status: 409 });
    const pin_hash = hashPin(pin);
    const { error } = await svc
      .from('hub_ledger_settings')
      .upsert({ shop_id: shopId, pin_hash, pin_set_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'shop_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ unlockToken: issueUnlockToken(userId, Date.now()) });
  }

  if (action === 'unlock') {
    if (!settings?.pin_hash || !verifyPin(pin, settings.pin_hash)) {
      await new Promise((r) => setTimeout(r, 400));
      return NextResponse.json({ error: 'PIN incorrect' }, { status: 401 });
    }
    return NextResponse.json({ unlockToken: issueUnlockToken(userId, Date.now()) });
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}
