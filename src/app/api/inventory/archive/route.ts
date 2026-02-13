import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

// GET — Lister les produits archivés
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');

    if (!shopId) {
      return NextResponse.json({ error: 'Missing shopId' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data: products, error } = await supabase
      .from('products')
      .select(`
        id,
        shopify_id,
        title,
        handle,
        image_url,
        status,
        product_type,
        synced_at,
        variants:product_variants(
          id,
          title,
          sku,
          option1,
          option2,
          option3,
          shopify_active
        )
      `)
      .eq('shop_id', shopId)
      .eq('status', 'archived')
      .order('title');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ products: products || [] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH — Changer le statut d'un produit
// action=restore : archived → local
// action=archive : local/draft → archived
export async function PATCH(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');
    const shopId = searchParams.get('shopId');
    const action = searchParams.get('action') || 'restore';

    if (!productId || !shopId) {
      return NextResponse.json({ error: 'Missing productId or shopId' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data: product, error: fetchError } = await supabase
      .from('products')
      .select('id, shop_id, status')
      .eq('id', productId)
      .eq('shop_id', shopId)
      .single();

    if (fetchError || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    if (action === 'archive') {
      if (!['local', 'draft'].includes(product.status)) {
        return NextResponse.json({ error: 'Only local products can be archived' }, { status: 400 });
      }
      const { error } = await supabase
        .from('products')
        .update({ status: 'archived' })
        .eq('id', productId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      if (product.status !== 'archived') {
        return NextResponse.json({ error: 'Product is not archived' }, { status: 400 });
      }
      const { error } = await supabase
        .from('products')
        .update({ status: 'local' })
        .eq('id', productId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE — Supprimer définitivement un produit et ses variantes
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');
    const shopId = searchParams.get('shopId');

    if (!productId || !shopId) {
      return NextResponse.json({ error: 'Missing productId or shopId' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Vérifier que le produit existe, appartient au shop, et est archivé
    const { data: product, error: fetchError } = await supabase
      .from('products')
      .select('id, shop_id, status')
      .eq('id', productId)
      .eq('shop_id', shopId)
      .single();

    if (fetchError || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    if (product.status !== 'archived') {
      return NextResponse.json(
        { error: 'Only archived products can be permanently deleted' },
        { status: 400 }
      );
    }

    // Supprimer les variantes d'abord (inventory_levels cascade automatiquement)
    await supabase
      .from('product_variants')
      .delete()
      .eq('product_id', productId);

    // Supprimer le produit
    const { error: deleteError } = await supabase
      .from('products')
      .delete()
      .eq('id', productId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
