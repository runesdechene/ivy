import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get('shopId');
  if (!shopId) return NextResponse.json({ error: 'shopId required' }, { status: 400 });

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('products')
    .select('id, title')
    .eq('shop_id', shopId)
    .in('status', ['active', 'local', 'draft'])
    .order('title', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ products: data ?? [] });
}
