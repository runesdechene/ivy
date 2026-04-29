import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();
  const { error } = await supabase.from('container_instances').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const supabase = createServerClient();

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const trimmed = typeof body.name === 'string' ? body.name.trim() : '';
    updates.name = trimmed.length > 0 ? trimmed : null;
  }
  if (body.position !== undefined) updates.position = body.position;
  if (body.filter_product_type !== undefined) {
    const v = typeof body.filter_product_type === 'string' ? body.filter_product_type.trim() : null;
    updates.filter_product_type = v && v.length > 0 ? v : null;
  }
  if (body.filter_size !== undefined) {
    const v = typeof body.filter_size === 'string' ? body.filter_size.trim() : null;
    updates.filter_size = v && v.length > 0 ? v : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('container_instances')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ instance: data });
}
