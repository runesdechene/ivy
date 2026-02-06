import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolve a variant ID that could be a Supabase UUID or a Shopify numeric ID
async function resolveVariantId(variantId: string): Promise<string | null> {
  if (UUID_REGEX.test(variantId)) return variantId;

  const { data } = await supabase
    .from('product_variants')
    .select('id')
    .eq('shopify_id', variantId)
    .single();

  return data?.id || null;
}

// Resolve a location ID that could be a Supabase UUID or a Shopify numeric ID
async function resolveLocationId(locationId: string): Promise<string | null> {
  if (UUID_REGEX.test(locationId)) return locationId;

  const { data } = await supabase
    .from('locations')
    .select('id')
    .eq('shopify_id', locationId)
    .single();

  return data?.id || null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      shopId,
      locationId,
      sellerId,
      customerEmail,
      customerPhone,
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

    // Resolve location ID (could be Shopify ID)
    const resolvedLocationId = locationId ? await resolveLocationId(locationId) : null;

    // Create sale header
    const { data: sale, error: saleError } = await supabase
      .from('pos_sales')
      .insert({
        shop_id: shopId,
        location_id: resolvedLocationId,
        seller_id: sellerId || null,
        customer_email: customerEmail || null,
        customer_phone: customerPhone || null,
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

    // Resolve variant IDs (could be Shopify IDs) to Supabase UUIDs
    const saleItems = [];
    for (const item of items) {
      const resolvedId = await resolveVariantId(item.variantId);
      if (!resolvedId) {
        console.error(`Variant not found for ID: ${item.variantId}`);
        await supabase.from('pos_sales').delete().eq('id', sale.id);
        return NextResponse.json(
          { error: `Variant not found: ${item.variantId}` },
          { status: 400 }
        );
      }
      saleItems.push({
        sale_id: sale.id,
        variant_id: resolvedId,
        product_title: item.productTitle,
        variant_title: item.variantTitle || null,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        discount_percentage: item.discountPercentage || 0,
        discount_amount: item.discountAmount || 0,
        total_price: item.totalPrice,
      });
    }

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

  } catch (error: any) {
    console.error('Error in POST /api/pos/sales:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
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

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { saleId, sellerId, customerEmail, customerPhone, notes, items } = body;

    if (!saleId) {
      return NextResponse.json({ error: 'Missing saleId' }, { status: 400 });
    }

    // Update sale header
    const updates: Record<string, any> = {};
    if (sellerId !== undefined) updates.seller_id = sellerId || null;
    if (customerEmail !== undefined) updates.customer_email = customerEmail || null;
    if (customerPhone !== undefined) updates.customer_phone = customerPhone || null;
    if (notes !== undefined) updates.notes = notes || null;

    // If items are provided, recalculate totals
    if (items && items.length > 0) {
      const subtotal = items.reduce((sum: number, item: any) => sum + item.quantity * item.unitPrice, 0);
      const discountAmount = items.reduce((sum: number, item: any) => sum + (item.discountAmount || 0), 0);
      updates.subtotal = subtotal;
      updates.discount_amount = discountAmount;
      updates.total_amount = subtotal - discountAmount;
      updates.items_count = items.reduce((sum: number, item: any) => sum + item.quantity, 0);
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('pos_sales')
        .update(updates)
        .eq('id', saleId);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    // If items provided, replace all sale items
    if (items && items.length > 0) {
      // Delete existing items
      await supabase.from('pos_sale_items').delete().eq('sale_id', saleId);

      // Insert new items
      const saleItems = items.map((item: any) => ({
        sale_id: saleId,
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
        return NextResponse.json({ error: itemsError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in PUT /api/pos/sales:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const saleId = searchParams.get('saleId');

    if (!saleId) {
      return NextResponse.json({ error: 'Missing saleId' }, { status: 400 });
    }

    // Delete items first (cascade should handle it, but be explicit)
    await supabase.from('pos_sale_items').delete().eq('sale_id', saleId);

    const { error } = await supabase
      .from('pos_sales')
      .delete()
      .eq('id', saleId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/pos/sales:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
