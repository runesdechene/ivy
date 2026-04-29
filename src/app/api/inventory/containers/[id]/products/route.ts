import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const productIds: string[] = Array.isArray(body.product_ids) ? body.product_ids : [];

  const supabase = createServerClient();

  const { error: dErr } = await supabase
    .from('container_instance_products')
    .delete()
    .eq('container_instance_id', id);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  if (productIds.length > 0) {
    const rows = productIds.map((pid) => ({ container_instance_id: id, product_id: pid }));
    const { error: iErr } = await supabase.from('container_instance_products').insert(rows);
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, count: productIds.length });
}
