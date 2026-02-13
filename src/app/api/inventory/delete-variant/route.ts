import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const variantId = searchParams.get('variantId');
    const shopId = searchParams.get('shopId');

    if (!variantId || !shopId) {
      return NextResponse.json(
        { error: 'Missing variantId or shopId' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Vérifier que la variante existe, appartient au shop, et est locale
    const { data: variant, error: fetchError } = await supabase
      .from('product_variants')
      .select('id, shopify_active, product_id, products!inner(shop_id)')
      .eq('id', variantId)
      .single();

    if (fetchError || !variant) {
      return NextResponse.json(
        { error: 'Variant not found' },
        { status: 404 }
      );
    }

    // Vérifier que le produit appartient au shop
    const product = variant.products as unknown as { shop_id: string };
    if (product.shop_id !== shopId) {
      return NextResponse.json(
        { error: 'Variant does not belong to this shop' },
        { status: 403 }
      );
    }

    // Ne jamais supprimer une variante live
    if (variant.shopify_active !== false) {
      return NextResponse.json(
        { error: 'Cannot delete a live Shopify variant' },
        { status: 400 }
      );
    }

    // Supprimer (inventory_levels et variant_metafields cascade automatiquement)
    const { error: deleteError } = await supabase
      .from('product_variants')
      .delete()
      .eq('id', variantId);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Error deleting variant:', error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
