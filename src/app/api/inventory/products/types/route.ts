import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get('shopId');
  if (!shopId) {
    return NextResponse.json({ error: 'shopId required' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('products')
    .select('product_type')
    .eq('shop_id', shopId)
    .not('product_type', 'is', null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const types = Array.from(
    new Set((data ?? []).map((r: { product_type: string | null }) => r.product_type).filter(Boolean) as string[]),
  ).sort((a, b) => a.localeCompare(b));

  return NextResponse.json({ types });
}
