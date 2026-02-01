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
    const activeOnly = searchParams.get('activeOnly') === 'true';

    if (!shopId) {
      return NextResponse.json(
        { error: 'Missing shopId' },
        { status: 400 }
      );
    }

    let query = supabase
      .from('pos_discount_rules')
      .select('*')
      .eq('shop_id', shopId)
      .order('priority', { ascending: false });

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    const { data: rules, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(rules);

  } catch (error) {
    console.error('Error in GET /api/pos/discount-rules:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { shopId, name, description, expression, priority, isActive, isCombinable } = body;

    if (!shopId || !name || !expression) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const { data: rule, error } = await supabase
      .from('pos_discount_rules')
      .insert({
        shop_id: shopId,
        name,
        description: description || null,
        expression,
        priority: priority || 0,
        is_active: isActive !== false,
        is_combinable: isCombinable !== false,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(rule);

  } catch (error) {
    console.error('Error in POST /api/pos/discount-rules:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, description, expression, priority, isActive, isCombinable } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Missing rule id' },
        { status: 400 }
      );
    }

    const updateData: any = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (expression !== undefined) updateData.expression = expression;
    if (priority !== undefined) updateData.priority = priority;
    if (isActive !== undefined) updateData.is_active = isActive;
    if (isCombinable !== undefined) updateData.is_combinable = isCombinable;

    const { data: rule, error } = await supabase
      .from('pos_discount_rules')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(rule);

  } catch (error) {
    console.error('Error in PUT /api/pos/discount-rules:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Missing rule id' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('pos_discount_rules')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error in DELETE /api/pos/discount-rules:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
