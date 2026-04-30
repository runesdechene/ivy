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
  const normaliseStringArray = (raw: unknown): string[] | null => {
    if (raw === null || raw === undefined) return null;
    const arr = Array.isArray(raw) ? raw : [raw];
    const cleaned = arr
      .filter((v): v is string => typeof v === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return cleaned.length > 0 ? cleaned : null;
  };
  if (body.filter_product_type !== undefined) {
    updates.filter_product_type = normaliseStringArray(body.filter_product_type);
  }
  if (body.filter_size !== undefined) {
    updates.filter_size = normaliseStringArray(body.filter_size);
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
