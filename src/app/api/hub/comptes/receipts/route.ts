import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, ownsShop, requireUnlock } from '@/lib/hub-ledger/server-auth';

const BUCKET = 'hub-receipts';

export async function POST(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const shopId = form?.get('shopId');
  if (!(file instanceof File) || typeof shopId !== 'string' || !ownsShop(res.auth, shopId)) {
    return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  }
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Fichier trop volumineux (max 10 Mo)' }, { status: 400 });

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${shopId}/${crypto.randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error } = await res.auth.svc.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ path });
}

export async function GET(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const path = sp.get('path');
  const shopId = sp.get('shopId');
  if (!path || !shopId || !ownsShop(res.auth, shopId) || !path.startsWith(`${shopId}/`)) {
    return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  }

  const { data, error } = await res.auth.svc.storage.from(BUCKET).createSignedUrl(path, 60 * 5);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}
