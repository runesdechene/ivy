import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');

    if (!shopId) {
      return NextResponse.json({ error: 'Missing shopId' }, { status: 400 });
    }

    // Commandes atelier en cours (non expédiées, non remboursées)
    const { count: atelierCount } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shopId)
      .neq('display_fulfillment_status', 'FULFILLED')
      .neq('display_financial_status', 'REFUNDED');

    // Commandes stock actives (draft + requested)
    const { count: stockCount } = await supabase
      .from('supplier_orders')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shopId)
      .eq('status', 'requested');

    return NextResponse.json({
      atelier: atelierCount || 0,
      stock: stockCount || 0,
    });
  } catch (error) {
    console.error('Error fetching order counts:', error);
    return NextResponse.json({ error: 'Failed to fetch counts' }, { status: 500 });
  }
}
