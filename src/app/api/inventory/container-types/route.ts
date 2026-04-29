import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get('shopId');
  if (!shopId) return NextResponse.json({ error: 'shopId required' }, { status: 400 });

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('container_types')
    .select('*')
    .eq('shop_id', shopId)
    .order('name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ types: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { shop_id, name, max_capacity, empty_weight_g, ratio_w, ratio_h } = body;
  if (!shop_id || !name || !max_capacity) {
    return NextResponse.json({ error: 'shop_id, name, max_capacity required' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('container_types')
    .insert({
      shop_id,
      name,
      max_capacity,
      empty_weight_g: empty_weight_g ?? null,
      ratio_w: ratio_w ?? 1,
      ratio_h: ratio_h ?? 1,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ type: data });
}
