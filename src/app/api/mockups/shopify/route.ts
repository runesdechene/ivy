import { NextRequest, NextResponse } from 'next/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { autoriser, erreur, urlPublique } from '@/lib/mockups/serveur';
import { lireProduit } from '@/lib/mockups/donnees';
import { shopifyGraphql } from '@/lib/mockups/shopify';

/**
 * Envoi des mockups enregistrés sur Shopify, en deux temps pour ne jamais laisser un produit sans photo :
 *   POST  : crée les nouvelles images et les rattache à leurs variantes ; renvoie les anciennes et les nouvelles.
 *   PATCH : une fois les nouvelles traitées par Shopify (READY), supprime les anciennes.
 */

type Shop = { shopify_url: string; shopify_token: string };
interface Media { id: string; alt: string | null; status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED' }

async function boutique(svc: SupabaseClient, shopId: string): Promise<Shop> {
  const { data } = await svc.from('shops').select('shopify_url, shopify_token').eq('id', shopId).single();
  if (!data?.shopify_token) throw new Error('Boutique sans jeton Shopify');
  return data;
}

async function mediasDuProduit(shop: Shop, gid: string): Promise<Media[]> {
  const d = await shopifyGraphql<{ product: { media: { nodes: Media[] } } | null }>(shop,
    `query($id: ID!) { product(id: $id) { media(first: 250) { nodes { id alt status } } } }`, { id: gid });
  if (!d.product) throw new Error('Produit absent de Shopify');
  return d.product.media.nodes;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { shopId?: string; productId?: string; rattacher?: boolean } | null;
  const acces = await autoriser(request, body?.shopId);
  if (!acces.ok) return acces.reponse;
  const { svc } = acces.auth;

  try {
    const lu = await lireProduit(svc, acces.shopId, body?.productId ?? '');
    if (!lu) return erreur('Produit introuvable', 404);
    const { data: mockups, error } = await svc.from('mockups').select('couleur, face, image_path')
      .eq('shop_id', acces.shopId).eq('product_id', lu.produit.id);
    if (error) throw new Error(error.message);
    // Seulement les couleurs encore en vente : un mockup d'une couleur retirée n'a plus rien à faire sur Shopify.
    const couleurs = new Set(lu.variantes.map((v) => v.couleur));
    const aEnvoyer = (mockups ?? []).filter((m) => couleurs.has(m.couleur))
      .map((m) => ({ ...m, url: urlPublique(svc, m.image_path)!, alt: `${lu.produit.title} — ${m.couleur} — ${m.face}` }));
    if (aEnvoyer.length === 0) return erreur('Aucun mockup enregistré pour ce produit : génère-les d’abord');

    const shop = await boutique(svc, acces.shopId);
    const gid = `gid://shopify/Product/${lu.produit.shopify_id}`;
    const anciens = (await mediasDuProduit(shop, gid)).map((m) => m.id);

    // Chaque variante prend l'image de sa couleur : le recto, sinon le verso.
    const imageDe = (couleur: string) =>
      (aEnvoyer.find((m) => m.couleur === couleur && m.face === 'recto') ?? aEnvoyer.find((m) => m.couleur === couleur))?.url;
    const variants = body?.rattacher === false ? [] : lu.variantes.flatMap((v) => {
      const url = imageDe(v.couleur);
      return url ? [{ id: `gid://shopify/ProductVariant/${v.shopifyId}`, mediaSrc: [url] }] : [];
    });

    const d = await shopifyGraphql<{ productVariantsBulkUpdate: { product: { media: { nodes: Media[] } } } }>(shop,
      `mutation($productId: ID!, $media: [CreateMediaInput!], $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, media: $media, variants: $variants) {
          product { media(first: 250) { nodes { id alt status } } }
          userErrors { field message }
        }
      }`,
      { productId: gid, media: aEnvoyer.map((m) => ({ originalSource: m.url, alt: m.alt, mediaContentType: 'IMAGE' })), variants });

    const nouveaux = d.productVariantsBulkUpdate.product.media.nodes.filter((m) => !anciens.includes(m.id)).map((m) => m.id);
    return NextResponse.json({ anciens, nouveaux, envoyees: aEnvoyer.length, rattachees: variants.length });
  } catch (e) {
    return erreur((e as Error).message, 502);
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null) as { shopId?: string; productId?: string; anciens?: string[]; nouveaux?: string[] } | null;
  const acces = await autoriser(request, body?.shopId);
  if (!acces.ok) return acces.reponse;
  const { svc } = acces.auth;
  const anciens = body?.anciens ?? [];
  const nouveaux = body?.nouveaux ?? [];
  if (anciens.some((id) => nouveaux.includes(id))) return erreur('Une image à supprimer fait partie des nouvelles');

  try {
    const lu = await lireProduit(svc, acces.shopId, body?.productId ?? '');
    if (!lu) return erreur('Produit introuvable', 404);
    const shop = await boutique(svc, acces.shopId);
    const gid = `gid://shopify/Product/${lu.produit.shopify_id}`;

    const medias = await mediasDuProduit(shop, gid);
    const etat = (id: string) => medias.find((m) => m.id === id)?.status;
    if (nouveaux.some((id) => etat(id) === 'FAILED' || !etat(id))) return erreur('Shopify a refusé une des nouvelles images : les anciennes sont gardées', 502);
    if (nouveaux.some((id) => etat(id) !== 'READY')) return erreur('Images encore en traitement chez Shopify', 409);

    const aSupprimer = anciens.filter((id) => etat(id)); // déjà parties : rien à faire
    if (aSupprimer.length) {
      // shortcut: productDeleteMedia est dépréciée ; passer à fileUpdate/fileDelete quand le jeton aura write_files.
      await shopifyGraphql(shop, `mutation($productId: ID!, $mediaIds: [ID!]!) {
        productDeleteMedia(productId: $productId, mediaIds: $mediaIds) { deletedMediaIds userErrors: mediaUserErrors { message } }
      }`, { productId: gid, mediaIds: aSupprimer });
    }
    return NextResponse.json({ supprimees: aSupprimer.length });
  } catch (e) {
    return erreur((e as Error).message, 502);
  }
}
