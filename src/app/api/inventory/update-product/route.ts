import { NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

interface VariantChange {
  variantId: string;
  quantity: number;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { shopId, locationId, productId, changes } = body as {
      shopId: string;
      locationId: string;
      productId: string;
      changes: VariantChange[];
    };

    if (!shopId || !locationId || !productId || !changes?.length) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Récupérer les informations de la boutique
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('shopify_url, shopify_token')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      return NextResponse.json(
        { error: 'Shop not found' },
        { status: 404 }
      );
    }

    // Le locationId passé est directement l'ID Shopify de l'emplacement
    const shopifyLocationId = locationId;
    const results: { variantId: string; success: boolean; error?: string }[] = [];

    // Pour chaque variante modifiée
    for (const change of changes) {
      try {
        // Extraire l'ID numérique si c'est un GID Shopify (gid://shopify/ProductVariant/123456 -> 123456)
        let shopifyVariantId = change.variantId;
        if (shopifyVariantId.includes('gid://')) {
          shopifyVariantId = shopifyVariantId.split('/').pop() || shopifyVariantId;
        }

        // Récupérer l'inventory_item_id et le statut Shopify de la variante
        const { data: variant, error: variantError } = await supabase
          .from('product_variants')
          .select('id, inventory_item_id, shopify_active')
          .eq('shopify_id', shopifyVariantId)
          .single();

        if (variantError || !variant) {
          results.push({
            variantId: change.variantId,
            success: false,
            error: 'Variant not found in cache',
          });
          continue;
        }

        // Si la variante est live sur Shopify, mettre à jour Shopify d'abord
        if (variant.shopify_active !== false) {
          const shopifyUrl = shop.shopify_url.replace(/\/$/, '');
          const setResponse = await fetch(
            `https://${shopifyUrl}/admin/api/2024-01/inventory_levels/set.json`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': shop.shopify_token,
              },
              body: JSON.stringify({
                location_id: shopifyLocationId,
                inventory_item_id: variant.inventory_item_id,
                available: change.quantity,
              }),
            }
          );

          if (!setResponse.ok) {
            const errorData = await setResponse.json();
            results.push({
              variantId: change.variantId,
              success: false,
              error: errorData.errors || 'Shopify API error',
            });
            continue;
          }
        }

        // Mettre à jour le cache Supabase (variantes live ET locales)
        await supabase
          .from('inventory_levels')
          .upsert({
            variant_id: variant.id,
            location_id: shopifyLocationId,
            quantity: change.quantity,
            synced_at: new Date().toISOString(),
          }, {
            onConflict: 'variant_id,location_id',
          });

        results.push({
          variantId: change.variantId,
          success: true,
        });
      } catch (err: any) {
        results.push({
          variantId: change.variantId,
          success: false,
          error: err.message,
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return NextResponse.json({
      success: failCount === 0,
      stats: {
        updated: successCount,
        failed: failCount,
      },
      results,
    });
  } catch (error: any) {
    console.error('Error updating product inventory:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
