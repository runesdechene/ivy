import { NextRequest, NextResponse } from 'next/server';
import { autoriser, erreur } from '@/lib/mockups/serveur';
import { METACHAMPS, lireTaille, type VarianteImpression } from '@/lib/mockups/regles';
import { shopifyGraphql } from '@/lib/mockups/shopify';

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
    .select('id, shopify_id, sku, option1, option2, variant_metafields(key, value), inventory_levels(quantity)')
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
  // Stock par couleur : prévient avant de retirer une couleur qui a encore des pièces.
  const stockParCouleur: Record<string, number> = {};
  for (const v of lignes ?? []) {
    stockParCouleur[v.option1 ?? ''] = (stockParCouleur[v.option1 ?? ''] ?? 0) + v.inventory_levels.reduce((s, l) => s + Math.max(0, l.quantity ?? 0), 0);
  }
  return NextResponse.json({ produit, variantes, stockParCouleur });
}

/**
 * Retire une couleur du produit : supprime toutes ses variantes sur Shopify, puis les marque inactives dans IVY
 * (comme le fait la synchro pour une variante disparue : l'historique de stock reste).
 */
export async function DELETE(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const acces = await autoriser(request, params.get('shopId'));
  if (!acces.ok) return acces.reponse;
  const svc = acces.auth.svc;
  const couleur = params.get('couleur');
  if (!couleur) return erreur('Couleur manquante');

  const [{ data: produit }, { data: shop }] = await Promise.all([
    svc.from('products').select('id, shopify_id').eq('shop_id', acces.shopId).eq('id', params.get('productId') ?? '').maybeSingle(),
    svc.from('shops').select('shopify_url, shopify_token').eq('id', acces.shopId).single(),
  ]);
  if (!produit) return erreur('Produit introuvable', 404);
  if (!shop?.shopify_token) return erreur('Boutique sans jeton Shopify', 500);

  const { data: variantes, error } = await svc.from('product_variants').select('id, shopify_id, option1')
    .eq('product_id', produit.id).eq('shopify_active', true);
  if (error) return erreur(error.message, 500);
  const aRetirer = (variantes ?? []).filter((v) => v.option1 === couleur);
  if (aRetirer.length === 0) return erreur('Aucune variante de cette couleur', 404);
  if (aRetirer.length === variantes!.length) return erreur('C’est la dernière couleur du produit : supprime plutôt le produit sur Shopify');

  try {
    await shopifyGraphql(shop, `mutation($productId: ID!, $variantsIds: [ID!]!) {
      productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) { userErrors { message } }
    }`, {
      productId: `gid://shopify/Product/${produit.shopify_id}`,
      variantsIds: aRetirer.map((v) => `gid://shopify/ProductVariant/${v.shopify_id}`),
    });
  } catch (e) {
    return erreur(`Shopify : ${(e as Error).message}`, 502);
  }

  const { error: majErreur } = await svc.from('product_variants').update({ shopify_active: false }).in('id', aRetirer.map((v) => v.id));
  if (majErreur) return erreur(`Supprimé sur Shopify, mais IVY n’a pas suivi : ${majErreur.message}. Reprends le produit de Shopify.`, 500);
  return NextResponse.json({ retirees: aRetirer.length });
}
