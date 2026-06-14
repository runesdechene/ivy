import { NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

/**
 * Valeurs complètes des métachamps d'UN produit (chargées à l'ouverture d'une fiche).
 * La liste d'inventaire n'envoie qu'un compte par variante pour rester légère ; les
 * valeurs (namespace/key/value) ne sont récupérées qu'ici, à la demande.
 *
 * GET /api/products/metafields?productId=<supabase product id>
 * → { byVariant: { [variantSupabaseId]: [{ namespace, key, value }] } }
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');
    if (!productId) {
      return NextResponse.json({ error: 'productId required' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('variant_metafields')
      .select('variant_id, namespace, key, value, product_variants!inner(product_id)')
      .eq('product_variants.product_id', productId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const byVariant: Record<string, { namespace: string; key: string; value: string }[]> = {};
    for (const row of (data as any[]) || []) {
      (byVariant[row.variant_id] ||= []).push({
        namespace: row.namespace,
        key: row.key,
        value: row.value,
      });
    }

    return NextResponse.json({ byVariant });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
