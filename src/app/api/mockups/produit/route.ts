import { NextRequest, NextResponse } from 'next/server';
import { autoriser, erreur } from '@/lib/mockups/serveur';
import { METACHAMPS, lireTaille, type VarianteImpression } from '@/lib/mockups/regles';

/** Un produit du shop et ses variantes actives, avec leurs métachamps d'impression. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const acces = await autoriser(request, params.get('shopId'));
  if (!acces.ok) return acces.reponse;
  const svc = acces.auth.svc;

  const { data: produit } = await svc.from('products').select('id, title, shopify_id')
    .eq('shop_id', acces.shopId).eq('id', params.get('productId') ?? '').maybeSingle();
  if (!produit) return erreur('Produit introuvable', 404);

  const { data: lignes, error } = await svc.from('product_variants')
    .select('id, shopify_id, sku, option1, option2, variant_metafields(key, value)')
    .eq('product_id', produit.id).eq('shopify_active', true)
    .in('variant_metafields.key', Object.values(METACHAMPS));
  if (error) return erreur(error.message, 500);

  const variantes: VarianteImpression[] = (lignes ?? []).map((v) => {
    const mf = (cle: string) => v.variant_metafields.find((m) => m.key === cle)?.value ?? null;
    return {
      id: v.id, shopifyId: v.shopify_id, couleur: v.option1 ?? '', tailleVetement: v.option2, sku: v.sku,
      recto: mf(METACHAMPS.recto), verso: mf(METACHAMPS.verso), taille: lireTaille(mf(METACHAMPS.taille)),
    };
  });
  return NextResponse.json({ produit, variantes });
}
