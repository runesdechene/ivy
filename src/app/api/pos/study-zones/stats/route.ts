import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get('shopId');
  const zoneId = searchParams.get('zoneId');
  const locationId = searchParams.get('locationId');

  if (!shopId || !zoneId) {
    return NextResponse.json({ error: 'Missing shopId or zoneId' }, { status: 400 });
  }

  // Get zone dates
  const { data: zone, error: zoneError } = await supabase
    .from('pos_study_zones')
    .select('*')
    .eq('id', zoneId)
    .single();

  if (zoneError || !zone) {
    return NextResponse.json({ error: 'Zone not found' }, { status: 404 });
  }

  // Get sales in date range
  let salesQuery = supabase
    .from('pos_sales')
    .select('id, seller_id, total_amount, subtotal, discount_amount, items_count, is_refund, created_at')
    .eq('shop_id', shopId)
    .gte('created_at', `${zone.date_from}T00:00:00`)
    .lte('created_at', `${zone.date_to}T23:59:59`);

  if (locationId) {
    salesQuery = salesQuery.eq('location_id', locationId);
  }

  const { data: sales, error: salesError } = await salesQuery;

  if (salesError) {
    return NextResponse.json({ error: salesError.message }, { status: 500 });
  }

  const allSales = sales || [];
  const actualSales = allSales.filter(s => !s.is_refund);
  const refunds = allSales.filter(s => s.is_refund);

  // Get sale items for product stats
  const saleIds = allSales.map(s => s.id);
  let items: any[] = [];

  if (saleIds.length > 0) {
    // Batch fetch in chunks of 100 to avoid URL length limits
    for (let i = 0; i < saleIds.length; i += 100) {
      const chunk = saleIds.slice(i, i + 100);
      const { data: itemsData } = await supabase
        .from('pos_sale_items')
        .select('sale_id, product_title, variant_title, quantity, unit_price, total_price')
        .in('sale_id', chunk);

      if (itemsData) {
        items = [...items, ...itemsData];
      }
    }
  }

  // Get sellers
  const { data: sellers } = await supabase
    .from('pos_sellers')
    .select('id, name, initials, color')
    .eq('shop_id', shopId);

  const sellersMap = new Map((sellers || []).map(s => [s.id, s]));

  // --- Compute stats ---

  // Revenue
  const totalRevenue = actualSales.reduce((sum, s) => sum + Number(s.total_amount), 0);
  const totalRefunds = refunds.reduce((sum, s) => sum + Math.abs(Number(s.total_amount)), 0);
  const totalDiscount = actualSales.reduce((sum, s) => sum + Number(s.discount_amount || 0), 0);
  const totalItemsSold = actualSales.reduce((sum, s) => sum + s.items_count, 0);
  const averageCart = actualSales.length > 0 ? totalRevenue / actualSales.length : 0;

  // Top products
  const productMap = new Map<string, { quantity: number; revenue: number }>();
  for (const item of items) {
    if (item.quantity > 0) {
      const key = item.product_title;
      const existing = productMap.get(key) || { quantity: 0, revenue: 0 };
      productMap.set(key, {
        quantity: existing.quantity + item.quantity,
        revenue: existing.revenue + Number(item.total_price),
      });
    }
  }
  const topProducts = Array.from(productMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.quantity - a.quantity);

  // Top variants (color/size breakdown)
  const variantMap = new Map<string, { quantity: number; revenue: number }>();
  for (const item of items) {
    if (item.quantity > 0) {
      const key = `${item.product_title} — ${item.variant_title || 'Default'}`;
      const existing = variantMap.get(key) || { quantity: 0, revenue: 0 };
      variantMap.set(key, {
        quantity: existing.quantity + item.quantity,
        revenue: existing.revenue + Number(item.total_price),
      });
    }
  }
  const topVariants = Array.from(variantMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 20);

  // Seller leaderboard
  const sellerMap = new Map<string, { salesCount: number; revenue: number; itemsSold: number }>();
  for (const sale of actualSales) {
    if (sale.seller_id) {
      const existing = sellerMap.get(sale.seller_id) || { salesCount: 0, revenue: 0, itemsSold: 0 };
      sellerMap.set(sale.seller_id, {
        salesCount: existing.salesCount + 1,
        revenue: existing.revenue + Number(sale.total_amount),
        itemsSold: existing.itemsSold + sale.items_count,
      });
    }
  }
  const sellerLeaderboard = Array.from(sellerMap.entries())
    .map(([sellerId, data]) => {
      const seller = sellersMap.get(sellerId);
      return {
        sellerId,
        name: seller?.name || 'Inconnu',
        initials: seller?.initials || null,
        color: seller?.color || null,
        ...data,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // Sales by day
  const dayMap = new Map<string, { salesCount: number; revenue: number; itemsSold: number }>();
  for (const sale of actualSales) {
    const day = sale.created_at.split('T')[0];
    const existing = dayMap.get(day) || { salesCount: 0, revenue: 0, itemsSold: 0 };
    dayMap.set(day, {
      salesCount: existing.salesCount + 1,
      revenue: existing.revenue + Number(sale.total_amount),
      itemsSold: existing.itemsSold + sale.items_count,
    });
  }
  const salesByDay = Array.from(dayMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({
    zone,
    summary: {
      salesCount: actualSales.length,
      refundsCount: refunds.length,
      totalRevenue,
      totalRefunds,
      totalDiscount,
      totalItemsSold,
      averageCart,
    },
    topProducts,
    topVariants,
    sellerLeaderboard,
    salesByDay,
  });
}
