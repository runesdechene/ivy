import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// PATCH - Réordonner les règles de prix
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderedIds } = body;

    if (!orderedIds || !Array.isArray(orderedIds) || orderedIds.length === 0) {
      return NextResponse.json({ error: 'Missing orderedIds' }, { status: 400 });
    }

    // Mettre à jour le sort_order de chaque règle
    const updates = orderedIds.map((id: string, index: number) =>
      supabase
        .from('price_rules')
        .update({ sort_order: index })
        .eq('id', id)
    );

    await Promise.all(updates);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error reordering price rules:', error);
    return NextResponse.json({ error: 'Failed to reorder price rules' }, { status: 500 });
  }
}
