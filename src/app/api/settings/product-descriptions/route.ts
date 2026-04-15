import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get('shopId');

  if (!shopId) {
    return NextResponse.json({ error: 'Missing shopId' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('product_descriptions')
    .select('*')
    .eq('shop_id', shopId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ descriptions: data || [] });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { shopId, name, descriptionHtml, conditions, isActive } = body;

    if (!shopId || !name) {
      return NextResponse.json({ error: 'Missing shopId or name' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('product_descriptions')
      .insert({
        shop_id: shopId,
        name,
        description_html: descriptionHtml || '',
        conditions: conditions || [],
        is_active: isActive ?? true,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ description: data });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, descriptionHtml, conditions, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (descriptionHtml !== undefined) updateData.description_html = descriptionHtml;
    if (conditions !== undefined) updateData.conditions = conditions;
    if (isActive !== undefined) updateData.is_active = isActive;

    const { data, error } = await supabase
      .from('product_descriptions')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ description: data });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const { error } = await supabase
    .from('product_descriptions')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
