import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

export async function POST(request: NextRequest) {
  try {
    const { productId, shopId } = await request.json();

    if (!productId || !shopId) {
      return NextResponse.json({ error: 'Missing productId or shopId' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Vérifier que le produit est bien local
    const { data: product } = await supabase
      .from('products')
      .select('id, status')
      .eq('id', productId)
      .eq('shop_id', shopId)
      .single();

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    if (product.status !== 'local' && product.status !== 'draft') {
      return NextResponse.json({ error: 'Product is not local' }, { status: 400 });
    }

    // Passer toutes les variantes en shopify_active = false
    const { data: updated } = await supabase
      .from('product_variants')
      .update({ shopify_active: false })
      .eq('product_id', productId)
      .eq('shopify_active', true)
      .select('id');

    return NextResponse.json({
      success: true,
      fixed: updated?.length || 0,
    });
  } catch (error) {
    console.error('Error fixing variant states:', error);
    return NextResponse.json({ error: 'Failed to fix variant states' }, { status: 500 });
  }
}
