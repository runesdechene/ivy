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

    // Requête identique à /api/products : partir de `products` (peu de lignes)
    // avec variantes et inventory_levels imbriquées.
    // Évite la limite de 1000 lignes de Supabase sur product_variants.
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select(`
        id,
        title,
        product_type,
        variants:product_variants(
          id,
          sku,
          option1,
          option2,
          option3,
          cost,
          price,
          inventory_levels(
            quantity,
            location_id
          )
        )
      `)
      .eq('shop_id', shopId)
      .in('status', ['active', 'local', 'draft']);

    if (productsError) {
      console.error('Error fetching products:', productsError);
      return NextResponse.json({ error: productsError.message }, { status: 500 });
    }

    // Calculer les statistiques
    const stats = {
      totalStock: 0,
      totalStockValue: 0,
      totalSaleValue: 0,
      potentialProfit: 0,
      byProductType: {} as Record<string, { count: number; stock: number; value: number; saleValue: number }>,
      byColor: {} as Record<string, { count: number; stock: number }>,
      bySize: {} as Record<string, { count: number; stock: number }>,
      topProducts: [] as { title: string; stock: number; value: number; saleValue: number }[],
    };

    // Patterns pour détecter les tailles
    const sizePattern = /^(XXXS|XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL|\d+)$/i;

    for (const product of products || []) {
      const productTitle = product.title || 'Inconnu';
      const productType = product.product_type || 'Non défini';
      let productStock = 0;
      let productValue = 0;
      let productSaleValue = 0;

      for (const variant of (product.variants as any[]) || []) {
        const inventoryLevels = variant.inventory_levels || [];

        // Filtrer par emplacement en JS (même logique que /api/products)
        let rawQuantity = 0;
        if (locationId) {
          const level = inventoryLevels.find((il: any) => il.location_id === locationId);
          rawQuantity = level?.quantity || 0;
        } else {
          rawQuantity = inventoryLevels.reduce((sum: number, il: any) => sum + (il.quantity || 0), 0);
        }

        // Clamper à 0 : un stock négatif (surventes Shopify) ne doit pas réduire les totaux
        const quantity = Math.max(0, rawQuantity);

        const cost = variant.cost || 0;
        const price = variant.price || 0;
        const variantCostValue = quantity * cost;
        const variantSaleValue = quantity * price;

        stats.totalStock += quantity;
        stats.totalStockValue += variantCostValue;
        stats.totalSaleValue += variantSaleValue;
        productStock += quantity;
        productValue += variantCostValue;
        productSaleValue += variantSaleValue;

        // Analyser les options pour couleur et taille
        const options = [variant.option1, variant.option2, variant.option3].filter(Boolean);

        for (const option of options) {
          if (!option) continue;

          if (sizePattern.test(option)) {
            const sizeKey = option.toUpperCase();
            if (!stats.bySize[sizeKey]) {
              stats.bySize[sizeKey] = { count: 0, stock: 0 };
            }
            stats.bySize[sizeKey].count++;
            stats.bySize[sizeKey].stock += quantity;
          } else {
            const colorKey = option;
            if (!stats.byColor[colorKey]) {
              stats.byColor[colorKey] = { count: 0, stock: 0 };
            }
            stats.byColor[colorKey].count++;
            stats.byColor[colorKey].stock += quantity;
          }
        }
      }

      // Par type de produit
      if (!stats.byProductType[productType]) {
        stats.byProductType[productType] = { count: 0, stock: 0, value: 0, saleValue: 0 };
      }
      stats.byProductType[productType].count += (product.variants as any[])?.length || 0;
      stats.byProductType[productType].stock += productStock;
      stats.byProductType[productType].value += productValue;
      stats.byProductType[productType].saleValue += productSaleValue;

      // Top produits
      stats.topProducts.push({
        title: productTitle,
        stock: productStock,
        value: productValue,
        saleValue: productSaleValue,
      });
    }

    // Top 10 produits par stock
    stats.topProducts = stats.topProducts
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

    // Calculer le profit potentiel
    stats.potentialProfit = stats.totalSaleValue - stats.totalStockValue;

    return NextResponse.json(stats);

  } catch (error) {
    console.error('Error in inventory stats:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
