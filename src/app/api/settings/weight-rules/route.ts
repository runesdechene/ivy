import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';
import { normalizeSize, SIZE_LADDER, type SizeLabel } from '@/lib/weights/sizes';

const PAGE_SIZE = 1000;

interface WeightTypeRule {
  id: string;
  shop_id: string;
  product_type: string;
  reference_size: string;
  reference_grams: number;
  step_pct: number;
  created_at: string;
  updated_at: string;
}

interface ProductRow {
  id: string;
  product_type: string | null;
}

interface VariantOptionsRow {
  id: string;
  sku: string | null;
  title: string | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  weight_grams: number | null;
  product_id: string;
}

const MAX_UNWEIGHTED = 500;

// Récupère toutes les lignes d'une table paginée par blocs de PAGE_SIZE, triées par id
// (PostgREST plafonne à 1000 lignes et un range sans order est instable).
async function fetchAllProducts(
  supabase: ReturnType<typeof createServerClient>,
  shopId: string
): Promise<ProductRow[]> {
  const rows: ProductRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('products')
      .select('id, product_type')
      .eq('shop_id', shopId)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as ProductRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function fetchAllVariantOptions(
  supabase: ReturnType<typeof createServerClient>,
  productIds: string[]
): Promise<VariantOptionsRow[]> {
  const rows: VariantOptionsRow[] = [];
  // On chunk aussi les product_id (filtre .in) pour éviter une URL trop longue.
  const CHUNK = 200;
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const idsChunk = productIds.slice(i, i + CHUNK);
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('product_variants')
        .select('id, sku, title, option1, option2, option3, weight_grams, product_id')
        .in('product_id', idsChunk)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      rows.push(...(data as VariantOptionsRow[]));
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }
  return rows;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');

    if (!shopId) {
      return NextResponse.json({ error: 'Missing shopId' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data: rules, error: rulesError } = await supabase
      .from('weight_type_rules')
      .select('*')
      .eq('shop_id', shopId)
      .order('product_type', { ascending: true });

    if (rulesError) {
      return NextResponse.json({ error: rulesError.message }, { status: 500 });
    }

    const products = await fetchAllProducts(supabase, shopId);
    const productTypeById = new Map<string, string>();
    const productTypesSet = new Set<string>();
    for (const p of products) {
      const type = p.product_type || 'Sans type';
      productTypeById.set(p.id, type);
      productTypesSet.add(type);
    }

    const variantOptions = await fetchAllVariantOptions(supabase, products.map((p) => p.id));

    // Pour chaque type de produit, les tailles présentes (résolues depuis la VALEUR
    // des options, jamais depuis le nom de l'option), ordonnées selon SIZE_LADDER.
    const sizesByTypeSet = new Map<string, Set<SizeLabel>>();
    for (const v of variantOptions) {
      const type = productTypeById.get(v.product_id);
      if (!type) continue;

      const size = normalizeSize(v.option1) ?? normalizeSize(v.option2) ?? normalizeSize(v.option3);
      if (!size) continue;

      if (!sizesByTypeSet.has(type)) sizesByTypeSet.set(type, new Set());
      sizesByTypeSet.get(type)!.add(size);
    }

    const sizesByType: Record<string, SizeLabel[]> = {};
    for (const [type, sizes] of sizesByTypeSet.entries()) {
      sizesByType[type] = SIZE_LADDER.filter((s) => sizes.has(s));
    }

    // Variantes encore sans poids, pour la saisie unitaire en bas de page (plafonné).
    const unweighted = variantOptions
      .filter((v) => v.weight_grams === null)
      .slice(0, MAX_UNWEIGHTED)
      .map((v) => ({
        id: v.id,
        sku: v.sku,
        title: v.title,
        productType: productTypeById.get(v.product_id) || 'Sans type',
      }));

    return NextResponse.json({
      rules: (rules || []) as WeightTypeRule[],
      productTypes: Array.from(productTypesSet).sort(),
      sizesByType,
      unweighted,
      unweightedTotal: variantOptions.filter((v) => v.weight_grams === null).length,
    });
  } catch (error) {
    console.error('Error fetching weight rules:', error);
    return NextResponse.json({ error: 'Failed to fetch weight rules' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { shopId, productType, referenceSize, referenceGrams, stepPct } = body as {
      shopId?: string;
      productType?: string;
      referenceSize?: string;
      referenceGrams?: number;
      stepPct?: number;
    };

    if (!shopId || !productType || !referenceSize || referenceGrams === undefined || stepPct === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!normalizeSize(referenceSize)) {
      return NextResponse.json({ error: 'referenceSize hors échelle' }, { status: 400 });
    }

    if (referenceGrams <= 0) {
      return NextResponse.json({ error: 'referenceGrams doit être positif' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('weight_type_rules')
      .upsert(
        {
          shop_id: shopId,
          product_type: productType,
          reference_size: referenceSize,
          reference_grams: Math.round(referenceGrams),
          step_pct: stepPct,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'shop_id,product_type' }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error upserting weight rule:', error);
    return NextResponse.json({ error: 'Failed to save weight rule' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');
    const productType = searchParams.get('productType');

    if (!shopId || !productType) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { error } = await supabase
      .from('weight_type_rules')
      .delete()
      .eq('shop_id', shopId)
      .eq('product_type', productType);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting weight rule:', error);
    return NextResponse.json({ error: 'Failed to delete weight rule' }, { status: 500 });
  }
}
