import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { aggregateMovements } from '../_lib/aggregate';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get('shopId');
  const zoneId = searchParams.get('zoneId');
  const locationId = searchParams.get('locationId');

  if (!shopId || !zoneId) {
    return NextResponse.json({ error: 'Missing shopId or zoneId' }, { status: 400 });
  }

  // Get zone dates
  const { data: zone, error: zoneError } = await supabase
    .from('pos_study_zones')
    .select('*')
    .eq('id', zoneId)
    .single();

  if (zoneError || !zone) {
    return NextResponse.json({ error: 'Zone not found' }, { status: 404 });
  }

  // Resolve locationId — could be a Shopify numeric ID, need the Supabase UUID
  let resolvedLocationId = locationId;
  if (locationId) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(locationId);
    if (!isUuid) {
      const { data: loc } = await supabase
        .from('locations')
        .select('id')
        .eq('shopify_id', locationId)
        .single();
      resolvedLocationId = loc?.id || null;
    }
  }

  // Get stock movements in date range
  let query = supabase
    .from('stock_movements')
    .select('variant_id, product_title, variant_title, quantity, moved_on')
    .eq('shop_id', shopId)
    .gte('moved_on', zone.date_from)
    .lte('moved_on', zone.date_to);

  if (resolvedLocationId) {
    query = query.eq('location_id', resolvedLocationId);
  }

  const { data: movements, error: movementsError } = await query;

  if (movementsError) {
    return NextResponse.json({ error: movementsError.message }, { status: 500 });
  }

  const allMovements = movements || [];

  // Totals + top products / variants / names (logique partagée)
  const { totalItemsOut, totalItemsReturn, topProducts, topVariants, topNames } =
    aggregateMovements(allMovements as import('../_lib/aggregate').MovementRow[]);

  // Top options grouped by option name (Couleur, Taille, etc.)
  // First, get product option names for all variants involved
  const variantIds = [...new Set(allMovements.filter(m => m.quantity < 0).map(m => m.variant_id))];
  const optionsByCategory = new Map<string, Map<string, number>>();

  if (variantIds.length > 0) {
    // Fetch variants with their options and parent product option names
    for (let i = 0; i < variantIds.length; i += 100) {
      const chunk = variantIds.slice(i, i + 100);
      const { data: variants } = await supabase
        .from('product_variants')
        .select('id, option1, option2, option3, product:products(option1_name, option2_name, option3_name)')
        .in('id', chunk);

      if (variants) {
        // Build a map of variantId -> options
        const variantOptionsMap = new Map<string, { options: [string | null, string | null, string | null]; names: [string | null, string | null, string | null] }>();
        for (const v of variants) {
          const product = Array.isArray(v.product) ? v.product[0] : v.product;
          variantOptionsMap.set(v.id, {
            options: [v.option1, v.option2, v.option3],
            names: [product?.option1_name || null, product?.option2_name || null, product?.option3_name || null],
          });
        }

        // Count options per category from movements
        for (const m of allMovements) {
          if (m.quantity < 0) {
            const variantData = variantOptionsMap.get(m.variant_id);
            if (!variantData) continue;

            for (let j = 0; j < 3; j++) {
              const optionName = variantData.names[j];
              const optionValue = variantData.options[j];
              if (optionName && optionValue) {
                if (!optionsByCategory.has(optionName)) {
                  optionsByCategory.set(optionName, new Map());
                }
                const categoryMap = optionsByCategory.get(optionName)!;
                categoryMap.set(optionValue, (categoryMap.get(optionValue) || 0) + Math.abs(m.quantity));
              }
            }
          }
        }
      }
    }
  }

  // Convert to sorted arrays per category
  const topOptionsByCategory: Array<{ category: string; options: Array<{ name: string; quantity: number }> }> = [];
  for (const [category, valuesMap] of optionsByCategory) {
    const options = Array.from(valuesMap.entries())
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity);
    topOptionsByCategory.push({ category, options });
  }

  // Movements by day
  const dayMap = new Map<string, { itemsOut: number; itemsReturn: number }>();
  for (const m of allMovements) {
    const day = m.moved_on;
    const existing = dayMap.get(day) || { itemsOut: 0, itemsReturn: 0 };
    if (m.quantity < 0) {
      existing.itemsOut += Math.abs(m.quantity);
    } else {
      existing.itemsReturn += m.quantity;
    }
    dayMap.set(day, existing);
  }
  const movementsByDay = Array.from(dayMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({
    zone,
    summary: {
      totalItemsOut,
      totalItemsReturn,
    },
    topProducts,
    topVariants,
    topOptionsByCategory,
    topNames,
    movementsByDay,
  });
}
