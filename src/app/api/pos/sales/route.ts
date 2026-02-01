import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      shopId,
      locationId,
      sellerId,
      discountRuleId,
      subtotal,
      discountAmount,
      totalAmount,
      itemsCount,
      isRefund,
      items,
      notes,
      createdByUserId,
    } = body;

    if (!shopId || !items || items.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Create sale header
    const { data: sale, error: saleError } = await supabase
      .from('pos_sales')
      .insert({
        shop_id: shopId,
        location_id: locationId || null,
        seller_id: sellerId || null,
        discount_rule_id: discountRuleId || null,
        subtotal: subtotal,
        discount_amount: discountAmount || 0,
        total_amount: totalAmount,
        items_count: itemsCount,
        is_refund: isRefund || false,
        notes: notes || null,
        created_by_user_id: createdByUserId || null,
      })
      .select()
      .single();

    if (saleError) {
      console.error('Error creating sale:', saleError);
      return NextResponse.json(
        { error: saleError.message },
        { status: 500 }
      );
    }

    // Create sale items
    const saleItems = items.map((item: any) => ({
      sale_id: sale.id,
      variant_id: item.variantId,
      product_title: item.productTitle,
      variant_title: item.variantTitle || null,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      discount_percentage: item.discountPercentage || 0,
      discount_amount: item.discountAmount || 0,
      total_price: item.totalPrice,
    }));

    const { error: itemsError } = await supabase
      .from('pos_sale_items')
      .insert(saleItems);

    if (itemsError) {
      console.error('Error creating sale items:', itemsError);
      // Rollback sale header
      await supabase.from('pos_sales').delete().eq('id', sale.id);
      return NextResponse.json(
        { error: itemsError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      saleId: sale.id,
      message: isRefund ? 'Remboursement enregistré' : 'Vente enregistrée'
    });

  } catch (error) {
    console.error('Error in POST /api/pos/sales:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!shopId) {
      return NextResponse.json(
        { error: 'Missing shopId' },
        { status: 400 }
      );
    }

    const { data: sales, error } = await supabase
      .from('pos_sales')
      .select(`
        *,
        seller:pos_sellers(id, name, avatar_url),
        discount_rule:pos_discount_rules(id, name),
        items:pos_sale_items(*)
      `)
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(sales);

  } catch (error) {
    console.error('Error in GET /api/pos/sales:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
