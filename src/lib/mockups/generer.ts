import { createHash } from 'node:crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { Canvas, createCanvas, loadImage } from '@napi-rs/canvas';
import { centrer, chargerGabarit, chargerSource, composerMockup, peindre, utiliserPlateforme, versBlob, type Img } from './composer';
import { lireGabarits, lireMotif, lireProduit, lireReglages } from './donnees';
import { BUCKET, retirer, urlPublique } from './serveur';
import {
  avec300dpi, demandesImpression, fichierDemande, motifDuTitre, planifierApercus, roleDuFichier, teinteReglee, PX_PAR_CM_300DPI,
  type Apercu, type DemandeImpression, type Face, type ImpressionLue, type VarianteImpression,
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
  const [charge, brut] = await Promise.all([
    chargerGabarit(gabarits.find((g) => g.id === a.gabaritId)!),
    fetch(urlSource).then((r) => r.blob()).then(chargerSource),
  ]);
  const source = a.impression.pose === 'motif' ? centrer(brut, motif.axe) : brut;
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

const BUCKET_IMPRESSION = 'impression'; // privé : les dessins en pleine résolution (migration 070)
const DUREE_ADRESSE = 3600; // secondes de validité d'une adresse signée

/**
 * L'adresse signée d'un fichier d'impression : PNG 300 dpi, encre à 100 %.
 * Fabriqué une fois puis gardé : son chemin porte l'empreinte de ce qui le fabrique (source, axe, hauteur, teinte),
 * donc un motif changé donne un autre chemin, le fichier est refait et l'ancien effacé.
 */
export async function adresseImpression(svc: SupabaseClient, shopId: string, demande: DemandeImpression): Promise<string | null> {
  const { motif: cle, nom } = demande;
  const [{ reglages, dtfUrl }, motif] = await Promise.all([lireReglages(svc, shopId), lireMotif(svc, shopId, cle)]);
  const fichier = fichierDemande(demande, reglages, motif);
  const teinte = fichier && teinteReglee(reglages, fichier.teinte);
  const url = fichier && (motif.fichiers[fichier.source]?.url ?? (fichier.source === 'DTF' ? dtfUrl : null));
  if (!fichier || !teinte || !url) return null;

  const axe = fichier.hauteurCm ? motif.axe ?? null : null; // marque et DTF : pas d'axe
  const empreinte = createHash('sha256').update(JSON.stringify([url, fichier.hauteurCm, axe, teinte.couleur])).digest('hex').slice(0, 16);
  const dossier = `${shopId}/${cle.replace(/[^A-Z0-9]+/g, '-')}`;
  const base = nom.replace(/[^A-Za-z0-9-]+/g, '-');
  const chemin = `${dossier}/${base}.${empreinte}.png`;
  const stock = svc.storage.from(BUCKET_IMPRESSION);

  const { data: existants } = await stock.list(dossier, { search: `${base}.` });
  if (!existants?.some((f) => `${dossier}/${f.name}` === chemin)) {
    const brut = await chargerSource(await (await fetch(url)).blob());
    const source = fichier.hauteurCm ? centrer(brut, axe) : brut;
    const { w, h } = source.dessin;
    const hauteur = fichier.hauteurCm ? fichier.hauteurCm * PX_PAR_CM_300DPI : h;
    const png = await versBlob(peindre(source, teinte.couleur, w * hauteur / h, hauteur), 'image/png');
    const { error } = await stock.upload(chemin, avec300dpi(new Uint8Array(await png.arrayBuffer())), { contentType: 'image/png', upsert: true });
    if (error) throw new Error(`${nom} : ${error.message}`);
    // Les versions d'avant de ce fichier (motif changé depuis) partent.
    const anciens = (existants ?? []).map((f) => `${dossier}/${f.name}`).filter((p) => p.startsWith(`${dossier}/${base}.`) && p !== chemin);
    if (anciens.length) await stock.remove(anciens);
  }
  const { data, error } = await stock.createSignedUrl(chemin, DUREE_ADRESSE, { download: nom });
  if (error) throw new Error(`${nom} : ${error.message}`);
  return data.signedUrl;
}

/** Les fichiers à imprimer de tous les produits d'un motif : ce que l'onglet Motifs refait d'un coup. */
export async function fichiersDuMotifAImprimer(svc: SupabaseClient, shopId: string, cle: string): Promise<DemandeImpression[]> {
  const { data, error } = await svc.from('products').select('id, title').eq('shop_id', shopId).eq('status', 'active');
  if (error) throw new Error(error.message);
  const [{ reglages }, motif] = await Promise.all([lireReglages(svc, shopId), lireMotif(svc, shopId, cle)]);
  const variantes: VarianteImpression[] = [];
  for (const p of (data ?? []).filter((p) => motifDuTitre(p.title) === cle)) variantes.push(...(await lireProduit(svc, shopId, p.id))?.variantes ?? []);
  return demandesImpression(cle, variantes, reglages, motif);
}

/** Une ligne de commande : sa variante (pour trouver le motif) et l'impression figée à la commande. */
export type LigneAImprimer = ImpressionLue & { variantId: string };

/** Pour chaque ligne d'une commande : ses fichiers, d'après l'impression de la commande (elle fait foi), ou ce qui manque. */
export async function fichiersDesLignes(
  svc: SupabaseClient, shopId: string, lignes: LigneAImprimer[],
): Promise<{ variantId: string; fichiers: DemandeImpression[]; manque: string | null }[]> {
  const { data, error } = await svc.from('product_variants').select('id, products!inner(title, shop_id)')
    .in('id', lignes.map((l) => l.variantId)).eq('products.shop_id', shopId)
    .returns<{ id: string; products: { title: string } }[]>();
  if (error) throw new Error(error.message);
  const titreDe = new Map((data ?? []).map((v) => [v.id, v.products.title]));
  const { reglages } = await lireReglages(svc, shopId);
  const motifs = new Map<string, Awaited<ReturnType<typeof lireMotif>>>();

  const resultat = [];
  for (const l of lignes) {
    const cle = motifDuTitre(titreDe.get(l.variantId) ?? '');
    if (!cle) { resultat.push({ variantId: l.variantId, fichiers: [], manque: 'motif introuvable dans le titre' }); continue; }
    if (!motifs.has(cle)) motifs.set(cle, await lireMotif(svc, shopId, cle));
    const motif = motifs.get(cle)!;
    const fichiers = demandesImpression(cle, [l], reglages, motif);
    const sansSource = fichiers.map((d) => fichierDemande(d, reglages, motif)).find((f) => f && f.source !== 'DTF' && !motif.fichiers[f.source]);
    resultat.push({
      variantId: l.variantId,
      fichiers,
      manque: sansSource ? `fichier ${sansSource.source} à déposer dans Motifs`
        : fichiers.length ? null
        : Object.keys(motif.hauteurs).length ? 'métachamps d’impression à régler' : 'tailles du motif à régler dans Motifs',
    });
  }
  return resultat;
}
