import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const supabase = createServerClient();

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.max_capacity !== undefined) updates.max_capacity = body.max_capacity;
  if (body.empty_weight_g !== undefined) updates.empty_weight_g = body.empty_weight_g;
  if (body.ratio_w !== undefined) updates.ratio_w = body.ratio_w;
  if (body.ratio_h !== undefined) updates.ratio_h = body.ratio_h;

  const { data, error } = await supabase
    .from('container_types')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ type: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const { count, error: cErr } = await supabase
    .from('container_instances')
    .select('id', { head: true, count: 'exact' })
    .eq('container_type_id', id);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: 'Type utilisé par des instances actives.' }, { status: 409 });
  }

  const { error } = await supabase.from('container_types').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
