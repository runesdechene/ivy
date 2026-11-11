import { SupabaseClient } from '@supabase/supabase-js';
import { Canvas, createCanvas, loadImage } from '@napi-rs/canvas';
import { chargerGabarit, chargerSource, composerMockup, peindre, utiliserPlateforme, versBlob, type Img } from './composer';
import { lireGabarits, lireMotif, lireProduit, lireReglages } from './donnees';
import { BUCKET, retirer, urlPublique } from './serveur';
import {
  avec300dpi, fichiersImpression, motifDuTitre, planifierApercus, roleDuFichier, teinteReglee, PX_PAR_CM_300DPI,
  type Apercu, type Face,
} from './regles';

/** Côté serveur : monte un mockup avec le même code que le navigateur, l'enregistre dans IVY. */

// @napi-rs/canvas a la même API de dessin que le canvas du navigateur ; seuls ses types diffèrent, d'où les conversions.
utiliserPlateforme({
  toile: (largeur, hauteur) => createCanvas(largeur, hauteur) as unknown as HTMLCanvasElement,
  async chargerImage(source) {
    const octets = typeof source === 'string' ? await (await fetch(source)).arrayBuffer() : await source.arrayBuffer();
    return await loadImage(Buffer.from(octets)) as unknown as Img;
  },
  async exporter(canvas, type) {
    const toile = canvas as unknown as Canvas;
    const octets = type === 'image/webp' ? await toile.encode('webp', 90) : await toile.encode('png');
    return new Blob([new Uint8Array(octets)], { type });
  },
});

export type Resultat = { image_url: string } | { manque: NonNullable<Apercu['manque']> | 'motif' | 'impression' };

/** Un mockup (produit × couleur × face), motif en D-MAX comme sur Shopify. Remplace l'image précédente. */
export async function genererMockup(svc: SupabaseClient, shopId: string, productId: string, couleur: string, face: Face): Promise<Resultat> {
  const lu = await lireProduit(svc, shopId, productId);
  if (!lu) throw new Error('Produit introuvable');
  const cle = motifDuTitre(lu.produit.title);
  if (!cle) return { manque: 'motif' };

  const [{ reglages, dtfUrl }, { gabarits }, motif] = await Promise.all([
    lireReglages(svc, shopId), lireGabarits(svc, shopId), lireMotif(svc, shopId, cle),
  ]);
  const noms = Object.entries(motif.fichiers).map(([role, f]) => `${role}.${f.ext}`);
  const variantes = lu.variantes.filter((v) => v.couleur === couleur);
  const [a] = planifierApercus(variantes, [face], gabarits, noms, reglages, motif, 'D-MAX');
  if (!a) return { manque: 'impression' };
  if (a.manque) return { manque: a.manque };

  const urlSource = a.fichier ? motif.fichiers[roleDuFichier(a.fichier)!]!.url : dtfUrl; // DTF sans fichier propre : logo commun
  if (!urlSource) return { manque: 'fichier' };
  const [charge, source] = await Promise.all([
    chargerGabarit(gabarits.find((g) => g.id === a.gabaritId)!),
    fetch(urlSource).then((r) => r.blob()).then(chargerSource),
  ]);
  const hauteur = a.impression.pose === 'motif' ? motif.hauteurs['D-MAX'] ?? null : null;
  const image = await versBlob(composerMockup(charge, source, a.impression, reglages, hauteur), 'image/webp');

  // Nouveau nom à chaque fois : Shopify et les navigateurs ne resservent jamais une ancienne version.
  const path = `${shopId}/mockups/${productId}/${crypto.randomUUID()}.webp`;
  const { error } = await svc.storage.from(BUCKET).upload(path, new Uint8Array(await image.arrayBuffer()), { contentType: 'image/webp' });
  if (error) throw new Error(error.message);

  const { data: avant } = await svc.from('mockups').select('image_path')
    .eq('shop_id', shopId).eq('product_id', productId).eq('couleur', couleur).eq('face', face).maybeSingle();
  const { error: e2 } = await svc.from('mockups').upsert(
    { shop_id: shopId, product_id: productId, couleur, face, image_path: path, updated_at: new Date().toISOString() },
    { onConflict: 'shop_id,product_id,couleur,face' },
  );
  if (e2) { await retirer(svc, [path]); throw new Error(e2.message); }
  await retirer(svc, [avant?.image_path]);
  return { image_url: urlPublique(svc, path)! };
}

/**
 * Un fichier d'impression d'un produit (nom tel que `fichiersImpression` le donne) : PNG 300 dpi, encre à 100 %.
 * Hauteur de la fiche du motif, largeur en proportion ; marque et DTF à la taille réelle du fichier source.
 */
export async function fichierImpression(svc: SupabaseClient, shopId: string, productId: string, nom: string): Promise<Uint8Array | null> {
  const lu = await lireProduit(svc, shopId, productId);
  const cle = lu && motifDuTitre(lu.produit.title);
  if (!cle) return null;
  const [{ reglages, dtfUrl }, motif] = await Promise.all([lireReglages(svc, shopId), lireMotif(svc, shopId, cle)]);
  const fichier = fichiersImpression(cle, lu.variantes, reglages, motif).find((f) => f.nom === nom);
  const teinte = fichier && teinteReglee(reglages, fichier.teinte);
  const url = fichier && (motif.fichiers[fichier.source]?.url ?? (fichier.source === 'DTF' ? dtfUrl : null));
  if (!fichier || !teinte || !url) return null;

  const source = await chargerSource(await (await fetch(url)).blob());
  const { w, h } = source.dessin;
  const hauteur = fichier.hauteurCm ? fichier.hauteurCm * PX_PAR_CM_300DPI : h;
  const png = await versBlob(peindre(source, teinte.couleur, w * hauteur / h, hauteur), 'image/png');
  return avec300dpi(new Uint8Array(await png.arrayBuffer()));
}
