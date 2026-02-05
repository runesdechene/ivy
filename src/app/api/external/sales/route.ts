import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Validate API key and return shop_id if valid
async function validateApiKey(apiKey: string): Promise<{ shopId: string; permissions: string[] } | null> {
  if (!apiKey) return null;

  const keyPrefix = apiKey.slice(0, 8);
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  const { data, error } = await supabase
    .from('api_keys')
    .select('shop_id, permissions, expires_at, is_active')
    .eq('key_prefix', keyPrefix)
    .eq('key_hash', keyHash)
    .single();

  if (error || !data) return null;
  if (!data.is_active) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  // Update last_used_at
  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key_prefix', keyPrefix)
    .eq('key_hash', keyHash);

  return {
    shopId: data.shop_id,
    permissions: data.permissions || ['read:sales'],
  };
}

export async function GET(request: NextRequest) {
  try {
    // Get API key from header
    const authHeader = request.headers.get('Authorization');
    const apiKey = authHeader?.replace('Bearer ', '');

    if (!apiKey) {
      return NextResponse.json(
        { error: 'Missing API key. Use Authorization: Bearer <api_key>' },
        { status: 401 }
      );
    }

    const auth = await validateApiKey(apiKey);
    if (!auth) {
      return NextResponse.json(
        { error: 'Invalid or expired API key' },
        { status: 401 }
      );
    }

    if (!auth.permissions.includes('read:sales')) {
      return NextResponse.json(
        { error: 'Insufficient permissions. Required: read:sales' },
        { status: 403 }
      );
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');
    const since = searchParams.get('since'); // ISO date string
    const until = searchParams.get('until'); // ISO date string
    const includeItems = searchParams.get('include_items') === 'true';

    // Build query
    let query = supabase
      .from('pos_sales')
      .select(`
        id,
        created_at,
        subtotal,
        discount_amount,
        total_amount,
        items_count,
        is_refund,
        customer_email,
        customer_phone,
        seller:pos_sellers(id, name),
        location:locations(id, name),
        discount_rule:pos_discount_rules(id, name)
        ${includeItems ? ', items:pos_sale_items(id, product_title, variant_title, quantity, unit_price, discount_percentage, discount_amount, total_price)' : ''}
      `)
      .eq('shop_id', auth.shopId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (since) {
      query = query.gte('created_at', since);
    }
    if (until) {
      query = query.lte('created_at', until);
    }

    const { data: sales, error, count } = await query;

    if (error) {
      console.error('Error fetching sales:', error);
      return NextResponse.json(
        { error: 'Failed to fetch sales' },
        { status: 500 }
      );
    }

    // Format response
    const formattedSales = (sales || []).map((sale: any) => ({
      id: sale.id,
      created_at: sale.created_at,
      subtotal: sale.subtotal,
      discount_amount: sale.discount_amount,
      total_amount: sale.total_amount,
      items_count: sale.items_count,
      is_refund: sale.is_refund,
      customer: {
        email: sale.customer_email,
        phone: sale.customer_phone,
      },
      seller: sale.seller?.[0] || sale.seller || null,
      location: sale.location?.[0] || sale.location || null,
      discount_rule: sale.discount_rule?.[0] || sale.discount_rule || null,
      items: includeItems ? sale.items : undefined,
    }));

    return NextResponse.json({
      data: formattedSales,
      pagination: {
        limit,
        offset,
        has_more: formattedSales.length === limit,
      },
    });

  } catch (error) {
    console.error('Error in GET /api/external/sales:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
