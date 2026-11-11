import { NextRequest, NextResponse } from 'next/server';
import { autoriser, erreur } from '@/lib/mockups/serveur';
import { lireProduit } from '@/lib/mockups/donnees';
import { cleMotif, motifDuTitre } from '@/lib/mockups/regles';
import { boutique, shopifyGraphql } from '@/lib/mockups/shopify';

/** Un produit du shop et ses variantes actives, avec leurs métachamps d'impression et le stock par couleur. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const acces = await autoriser(request, params.get('shopId'));
  if (!acces.ok) return acces.reponse;

  // Sans productId : produits actifs dont le titre exact ou le motif correspond à `recherche` (« Loki » ou « Loki | T-shirt unisexe »).
  const recherche = params.get('recherche');
  if (recherche !== null && !params.get('productId')) {
    const { data, error } = await acces.auth.svc.from('products').select('id, title').eq('shop_id', acces.shopId).eq('status', 'active');
    if (error) return erreur(error.message, 500);
    const voulu = cleMotif(recherche);
    return NextResponse.json({
      produits: (data ?? []).filter((p) => cleMotif(p.title) === voulu || motifDuTitre(p.title) === voulu),
    });
  }

  try {
    const lu = await lireProduit(acces.auth.svc, acces.shopId, params.get('productId') ?? '');
    return lu ? NextResponse.json(lu) : erreur('Produit introuvable', 404);
  } catch (e) {
    return erreur((e as Error).message, 500);
  }
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

  const { data: produit } = await svc.from('products').select('id, shopify_id')
    .eq('shop_id', acces.shopId).eq('id', params.get('productId') ?? '').maybeSingle();
  if (!produit) return erreur('Produit introuvable', 404);

  const { data: variantes, error } = await svc.from('product_variants').select('id, shopify_id, option1')
    .eq('product_id', produit.id).eq('shopify_active', true);
  if (error) return erreur(error.message, 500);
  const aRetirer = (variantes ?? []).filter((v) => v.option1 === couleur);
  if (aRetirer.length === 0) return erreur('Aucune variante de cette couleur', 404);
  if (aRetirer.length === variantes!.length) return erreur('C’est la dernière couleur du produit : supprime plutôt le produit sur Shopify');

  try {
    await shopifyGraphql(await boutique(svc, acces.shopId), `mutation($productId: ID!, $variantsIds: [ID!]!) {
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
