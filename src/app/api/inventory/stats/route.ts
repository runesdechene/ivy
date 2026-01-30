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
    const locationId = searchParams.get('locationId');

    if (!shopId) {
      return NextResponse.json({ error: 'Missing shopId' }, { status: 400 });
    }

    // Récupérer toutes les variantes avec leurs produits et niveaux d'inventaire
    // Filtrer par locationId si fourni
    let query = supabase
      .from('product_variants')
      .select(`
        id,
        sku,
        option1,
        option2,
        option3,
        cost,
        product:products!inner(
          id,
          title,
          product_type,
          shop_id
        ),
        inventory_levels!inner(
          quantity,
          location_id
        )
      `)
      .eq('product.shop_id', shopId);

    // Filtrer par emplacement si spécifié
    if (locationId) {
      query = query.eq('inventory_levels.location_id', locationId);
    }

    const { data: variants, error: variantsError } = await query;

    if (variantsError) {
      console.error('Error fetching variants:', variantsError);
      return NextResponse.json({ error: variantsError.message }, { status: 500 });
    }

    // Calculer les statistiques
    const stats = {
      totalVariants: 0,
      totalStock: 0,
      totalStockValue: 0,
      byProductType: {} as Record<string, { count: number; stock: number; value: number }>,
      byColor: {} as Record<string, { count: number; stock: number }>,
      bySize: {} as Record<string, { count: number; stock: number }>,
      topProducts: [] as { title: string; stock: number; value: number }[],
    };

    // Map pour agréger par produit
    const productStats = new Map<string, { title: string; stock: number; value: number }>();

    // Patterns pour détecter les tailles
    const sizePattern = /^(XXXS|XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL|\d+)$/i;

    for (const variant of variants || []) {
      const product = variant.product as any;
      const inventoryLevels = variant.inventory_levels || [];
      const totalQuantity = inventoryLevels.reduce((sum: number, il: any) => sum + (il.quantity || 0), 0);
      const cost = variant.cost || 0;
      const variantValue = totalQuantity * cost;

      stats.totalVariants++;
      stats.totalStock += totalQuantity;
      stats.totalStockValue += variantValue;

      // Par type de produit
      const productType = product?.product_type || 'Non défini';
      if (!stats.byProductType[productType]) {
        stats.byProductType[productType] = { count: 0, stock: 0, value: 0 };
      }
      stats.byProductType[productType].count++;
      stats.byProductType[productType].stock += totalQuantity;
      stats.byProductType[productType].value += variantValue;

      // Analyser les options pour couleur et taille
      const options = [variant.option1, variant.option2, variant.option3].filter(Boolean);
      
      for (const option of options) {
        if (!option) continue;
        
        // Détecter si c'est une taille
        if (sizePattern.test(option)) {
          const sizeKey = option.toUpperCase();
          if (!stats.bySize[sizeKey]) {
            stats.bySize[sizeKey] = { count: 0, stock: 0 };
          }
          stats.bySize[sizeKey].count++;
          stats.bySize[sizeKey].stock += totalQuantity;
        } else {
          // Sinon c'est probablement une couleur ou autre option
          const colorKey = option;
          if (!stats.byColor[colorKey]) {
            stats.byColor[colorKey] = { count: 0, stock: 0 };
          }
          stats.byColor[colorKey].count++;
          stats.byColor[colorKey].stock += totalQuantity;
        }
      }

      // Agréger par produit pour le top
      const productTitle = product?.title || 'Inconnu';
      const existing = productStats.get(productTitle);
      if (existing) {
        existing.stock += totalQuantity;
        existing.value += variantValue;
      } else {
        productStats.set(productTitle, { title: productTitle, stock: totalQuantity, value: variantValue });
      }
    }

    // Top 10 produits par stock
    stats.topProducts = Array.from(productStats.values())
      .sort((a, b) => b.stock - a.stock)
      .slice(0, 10);

    // Trier les couleurs et tailles par stock décroissant
    const sortedColors = Object.entries(stats.byColor)
      .sort((a, b) => b[1].stock - a[1].stock)
      .slice(0, 15);
    stats.byColor = Object.fromEntries(sortedColors);

    const sortedSizes = Object.entries(stats.bySize)
      .sort((a, b) => b[1].stock - a[1].stock);
    stats.bySize = Object.fromEntries(sortedSizes);

    // Trier les types par stock décroissant
    const sortedTypes = Object.entries(stats.byProductType)
      .sort((a, b) => b[1].stock - a[1].stock);
    stats.byProductType = Object.fromEntries(sortedTypes);

    return NextResponse.json(stats);

  } catch (error) {
    console.error('Error in inventory stats:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
