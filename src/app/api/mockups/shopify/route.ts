import { NextRequest, NextResponse } from 'next/server';
import { autoriser, BUCKET, erreur, retirer, urlPublique } from '@/lib/mockups/serveur';
import { genererDuo } from '@/lib/mockups/generer';
import { lireProduit } from '@/lib/mockups/donnees';
import { boutique, shopifyGraphql, type Boutique } from '@/lib/mockups/shopify';

/**
 * Envoi des mockups enregistrés sur Shopify, en deux temps pour ne jamais laisser un produit sans photo :
 *   POST  : crée les nouvelles images ; renvoie les anciennes et les nouvelles.
 *   PATCH : une fois les nouvelles traitées par Shopify (READY), les rattache à leurs variantes, vérifie, puis
 *           supprime les anciennes. À appeler toujours, même sans anciennes : c'est lui qui rattache.
 * Rattacher dans le POST (mediaSrc) échoue en silence et au hasard sur une image encore en traitement (Loki, 24/11/2026).
 */

interface Media { id: string; alt: string | null; status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED' }

async function mediasDuProduit(shop: Boutique, gid: string): Promise<Media[]> {
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
    const { data: mockups, error } = await svc.from('mockups').select('id, couleur, face, image_path')
      .eq('shop_id', acces.shopId).eq('product_id', lu.produit.id);
    if (error) throw new Error(error.message);
    // Seulement les couleurs encore en vente : un mockup d'une couleur retirée n'a plus rien à faire sur Shopify.
    const couleurs = new Set(lu.variantes.map((v) => v.couleur));
    const aEnvoyer = (mockups ?? []).filter((m) => couleurs.has(m.couleur))
      .map((m) => ({ ...m, url: urlPublique(svc, m.image_path)!, alt: `${lu.produit.title} — ${m.couleur} — ${m.face}` }));
    if (aEnvoyer.length === 0) return erreur('Aucun mockup enregistré pour ce produit : génère-les d’abord');

    // Une couleur imprimée des deux côtés part en une seule image, recto et verso assemblés (Uriel, 24/11/2026).
    // Les assemblages vivent dans un dossier à part, vidé à chaque envoi : Shopify garde sa propre copie.
    const dossierDuo = `${acces.shopId}/mockups/${lu.produit.id}/duo`;
    const { data: vieuxDuos } = await svc.storage.from(BUCKET).list(dossierDuo);
    await retirer(svc, (vieuxDuos ?? []).map((f) => `${dossierDuo}/${f.name}`));
    const envoi: { url: string; alt: string }[] = [];
    for (const couleur of [...new Set(aEnvoyer.map((m) => m.couleur))]) {
      const recto = aEnvoyer.find((m) => m.couleur === couleur && m.face === 'recto');
      const verso = aEnvoyer.find((m) => m.couleur === couleur && m.face === 'verso');
      if (!recto || !verso) { envoi.push(...aEnvoyer.filter((m) => m.couleur === couleur)); continue; }
      const duo = await genererDuo(recto.url, verso.url);
      const path = `${dossierDuo}/${crypto.randomUUID()}.webp`;
      const { error: e } = await svc.storage.from(BUCKET).upload(path, new Uint8Array(await duo.arrayBuffer()), { contentType: 'image/webp' });
      if (e) throw new Error(e.message);
      envoi.push({ url: urlPublique(svc, path)!, alt: `${lu.produit.title} — ${couleur} — duo` });
    }

    const shop = await boutique(svc, acces.shopId);
    const gid = `gid://shopify/Product/${lu.produit.shopify_id}`;
    const anciens = (await mediasDuProduit(shop, gid)).map((m) => m.id);

    // productVariantsBulkUpdate ignore `media` quand `variants` est vide : on crée les images par productUpdate.
    await shopifyGraphql(shop,
      `mutation($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
        productUpdate(product: $product, media: $media) { product { id } userErrors { field message } }
      }`,
      { product: { id: gid }, media: envoi.map((m) => ({ originalSource: m.url, alt: m.alt, mediaContentType: 'IMAGE' })) });

    const nouveaux = (await mediasDuProduit(shop, gid)).filter((m) => !anciens.includes(m.id)).map((m) => m.id);
    // Garde-fou : sans toutes ses nouvelles images, le PATCH supprimerait les anciennes pour rien.
    if (nouveaux.length !== envoi.length) return erreur(`Shopify a créé ${nouveaux.length} image(s) sur ${envoi.length} : rien n'est remplacé`, 502);
    // Repère « à jour sur Shopify » : un mockup régénéré après cette date redevient à envoyer.
    await svc.from('mockups').update({ envoye_le: new Date().toISOString() }).in('id', aEnvoyer.map((m) => m.id));
    return NextResponse.json({ anciens, nouveaux, envoyees: envoi.length });
  } catch (e) {
    return erreur((e as Error).message, 502);
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null) as { shopId?: string; productId?: string; anciens?: string[]; nouveaux?: string[]; rattacher?: boolean } | null;
  const acces = await autoriser(request, body?.shopId);
  if (!acces.ok) return acces.reponse;
  const { svc } = acces.auth;
  const anciens = body?.anciens ?? [];
  const nouveaux = body?.nouveaux ?? [];
  if (anciens.some((id) => nouveaux.includes(id))) return erreur('Une image à supprimer fait partie des nouvelles');
  if (anciens.length && !nouveaux.length) return erreur('Aucune nouvelle image : les anciennes sont gardées');

  try {
    const lu = await lireProduit(svc, acces.shopId, body?.productId ?? '');
    if (!lu) return erreur('Produit introuvable', 404);
    const shop = await boutique(svc, acces.shopId);
    const gid = `gid://shopify/Product/${lu.produit.shopify_id}`;

    const medias = await mediasDuProduit(shop, gid);
    const etat = (id: string) => medias.find((m) => m.id === id)?.status;
    if (nouveaux.some((id) => etat(id) === 'FAILED' || !etat(id))) return erreur('Shopify a refusé une des nouvelles images : les anciennes sont gardées', 502);
    if (nouveaux.some((id) => etat(id) !== 'READY')) return erreur('Images encore en traitement chez Shopify', 409);

    let rattachees = 0;
    if (body?.rattacher !== false) {
      // Chaque variante prend l'image de sa couleur (alt « <titre> — <couleur> — <face> ») : l'assemblage, sinon le recto, sinon le verso.
      const neuves = medias.filter((m) => nouveaux.includes(m.id));
      const alt = (couleur: string, face: string) => `${lu.produit.title} — ${couleur} — ${face}`;
      const imageDe = (couleur: string) =>
        (['duo', 'recto', 'verso'].map((f) => neuves.find((m) => m.alt === alt(couleur, f))).find(Boolean))?.id;
      const variants = lu.variantes.flatMap((v) => {
        const mediaId = imageDe(v.couleur);
        return mediaId ? [{ id: `gid://shopify/ProductVariant/${v.shopifyId}`, mediaId }] : [];
      });
      if (variants.length) {
        await shopifyGraphql(shop, `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } }
        }`, { productId: gid, variants });
        // Shopify peut accepter sans rattacher : on relit avant de toucher aux anciennes.
        const r = await shopifyGraphql<{ product: { variants: { nodes: { id: string; media: { nodes: { id: string }[] } }[] } } }>(shop,
          `query($id: ID!) { product(id: $id) { variants(first: 250) { nodes { id media(first: 1) { nodes { id } } } } } }`, { id: gid });
        const lien = new Map(r.product.variants.nodes.map((n) => [n.id, n.media.nodes[0]?.id]));
        const rates = variants.filter((v) => lien.get(v.id) !== v.mediaId).length;
        if (rates) return erreur(`${rates} variante(s) sur ${variants.length} sans leur nouvelle image : les anciennes sont gardées`, 502);
      }
      rattachees = variants.length;
    }

    const aSupprimer = anciens.filter((id) => etat(id)); // déjà parties : rien à faire
    if (aSupprimer.length) {
      // Une image de produit est un fichier Shopify : le supprimer la retire du produit et de ses variantes.
      await shopifyGraphql(shop, `mutation($fileIds: [ID!]!) {
        fileDelete(fileIds: $fileIds) { deletedFileIds userErrors { message } }
      }`, { fileIds: aSupprimer });
    }
    return NextResponse.json({ supprimees: aSupprimer.length, rattachees });
  } catch (e) {
    return erreur((e as Error).message, 502);
  }
}
