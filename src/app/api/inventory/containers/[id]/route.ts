import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();
  const { error } = await supabase.from('container_instances').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
