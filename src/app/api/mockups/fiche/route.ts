import { NextRequest, NextResponse } from 'next/server';
import { autoriser, erreur } from '@/lib/mockups/serveur';
import { boutique, shopifyGraphql } from '@/lib/mockups/shopify';

/**
 * La fiche d'un produit sur Shopify, en lecture et en écriture, pour que tout passe par IVY (Uriel, 24/11/2026) :
 * titre, handle, statut, tags, description Google, et les métachamps `custom` (illustrateur, illustration_produit…).
 * Un métachamp s'écrit avec le type de sa définition Shopify : une clé sans définition est refusée.
 */

interface Champ { cle: string; type: string; valeur: string | null; nom: string }
interface Fiche { id: string; titre: string; handle: string; statut: string; tags: string[]; seo: { titre: string | null; description: string | null }; champs: Champ[] }

async function produitShopify(svc: Parameters<typeof boutique>[0], shopId: string, productId: string) {
  const { data } = await svc.from('products').select('shopify_id').eq('shop_id', shopId).eq('id', productId).maybeSingle();
  return data ? `gid://shopify/Product/${data.shopify_id}` : null;
}

async function lire(shop: Awaited<ReturnType<typeof boutique>>, gid: string): Promise<Fiche> {
  const d = await shopifyGraphql<{
    product: { id: string; title: string; handle: string; status: string; tags: string[]; seo: { title: string | null; description: string | null };
      metafields: { nodes: { key: string; type: string; value: string }[] } } | null;
    metafieldDefinitions: { nodes: { key: string; name: string; type: { name: string } }[] };
  }>(shop, `query($id: ID!) {
    product(id: $id) { id title handle status tags seo { title description }
      metafields(first: 100, namespace: "custom") { nodes { key type value } } }
    metafieldDefinitions(first: 100, ownerType: PRODUCT, namespace: "custom") { nodes { key name type { name } } }
  }`, { id: gid });
  if (!d.product) throw new Error('Produit absent de Shopify');
  const valeurs = new Map(d.product.metafields.nodes.map((m) => [m.key, m]));
  const champs: Champ[] = d.metafieldDefinitions.nodes.map((def) => ({ cle: def.key, nom: def.name, type: def.type.name, valeur: valeurs.get(def.key)?.value ?? null }));
  const p = d.product;
  return { id: p.id, titre: p.title, handle: p.handle, statut: p.status, tags: p.tags, seo: { titre: p.seo.title, description: p.seo.description }, champs };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const acces = await autoriser(request, params.get('shopId'));
  if (!acces.ok) return acces.reponse;
  try {
    const gid = await produitShopify(acces.auth.svc, acces.shopId, params.get('productId') ?? '');
    if (!gid) return erreur('Produit introuvable', 404);
    return NextResponse.json(await lire(await boutique(acces.auth.svc, acces.shopId), gid));
  } catch (e) {
    return erreur((e as Error).message, 502);
  }
}

/** Corps : `{ shopId, productId, titre?, tags?, seoDescription?, champs?: { [cle]: valeur | null } }` ; renvoie la fiche relue. */
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null) as {
    shopId?: string; productId?: string; titre?: string; tags?: string[]; seoDescription?: string; champs?: Record<string, string | null>;
  } | null;
  const acces = await autoriser(request, body?.shopId);
  if (!acces.ok) return acces.reponse;
  if (body?.titre !== undefined && !body.titre.trim()) return erreur('Titre vide');
  if (body?.tags !== undefined && (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== 'string' || !t.trim()))) return erreur('Tags invalides');

  try {
    const gid = await produitShopify(acces.auth.svc, acces.shopId, body?.productId ?? '');
    if (!gid) return erreur('Produit introuvable', 404);
    const shop = await boutique(acces.auth.svc, acces.shopId);
    const avant = await lire(shop, gid);

    const champs = Object.entries(body?.champs ?? {});
    const inconnues = champs.filter(([cle]) => !avant.champs.some((c) => c.cle === cle)).map(([cle]) => cle);
    if (inconnues.length) return erreur(`Métachamp sans définition Shopify : ${inconnues.join(', ')}`);

    const produit: Record<string, unknown> = { id: gid };
    if (body?.titre !== undefined) produit.title = body.titre.trim();
    if (body?.tags !== undefined) produit.tags = body.tags.map((t) => t.trim());
    if (body?.seoDescription !== undefined) produit.seo = { title: avant.seo.titre, description: body.seoDescription };
    const aEcrire = champs.filter(([, v]) => v !== null).map(([cle, valeur]) =>
      ({ ownerId: gid, namespace: 'custom', key: cle, type: avant.champs.find((c) => c.cle === cle)!.type, value: valeur }));
    const aEffacer = champs.filter(([, v]) => v === null).map(([cle]) => ({ ownerId: gid, namespace: 'custom', key: cle }));

    // productUpdate (pas metafieldsSet seul) : les collections automatiques se recalculent sur un métachamp (protocole Nouveau motif).
    if (Object.keys(produit).length > 1 || aEcrire.length) {
      await shopifyGraphql(shop, `mutation($product: ProductUpdateInput!) {
        productUpdate(product: $product) { product { id } userErrors { field message } }
      }`, { product: { ...produit, ...(aEcrire.length ? { metafields: aEcrire.map(({ ownerId: _, ...m }) => m) } : {}) } });
    }
    if (aEffacer.length) {
      await shopifyGraphql(shop, `mutation($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) { deletedMetafields { key } userErrors { field message } }
      }`, { metafields: aEffacer });
    }
    return NextResponse.json(await lire(shop, gid));
  } catch (e) {
    return erreur((e as Error).message, 502);
  }
}
