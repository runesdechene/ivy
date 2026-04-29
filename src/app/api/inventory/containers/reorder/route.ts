import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderedIds, shopId, locationId } = body as {
      orderedIds?: string[];
      shopId?: string;
      locationId?: string;
    };

    if (!orderedIds || !Array.isArray(orderedIds) || orderedIds.length === 0) {
      return NextResponse.json({ error: 'orderedIds required' }, { status: 400 });
    }
    if (!shopId || !locationId) {
      return NextResponse.json({ error: 'shopId & locationId required' }, { status: 400 });
    }

    const supabase = createServerClient();

    const updates = orderedIds.map((id, index) =>
      supabase
        .from('container_instances')
        .update({ position: index })
        .eq('id', id)
        .eq('shop_id', shopId)
        .eq('location_id', String(locationId)),
    );

    const results = await Promise.all(updates);
    const firstError = results.find((r) => r.error);
    if (firstError?.error) {
      console.error('reorder containers failed:', firstError.error);
      return NextResponse.json({ error: firstError.error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error reordering containers:', error);
    return NextResponse.json({ error: 'Failed to reorder' }, { status: 500 });
  }
}
