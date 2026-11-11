import { SupabaseClient } from '@supabase/supabase-js';
import { dossierMotif, fichiersDuMotif, urlPublique } from './serveur';
import {
  METACHAMPS, OPACITE_ENCRE, lireTaille,
  type Face, type FicheMotif, type FichierDepose, type Gabarit, type Reglages, type Role, type VarianteImpression,
} from './regles';

/** Côté serveur : ce qu'il faut lire en base pour monter un mockup. Partagé par les routes et la génération. */

export async function lireReglages(svc: SupabaseClient, shopId: string): Promise<{ reglages: Reglages; dtfUrl: string | null }> {
  const { data, error } = await svc.from('mockup_reglages').select('teintes, dtf_path, opacite_encre').eq('shop_id', shopId).maybeSingle();
  if (error) throw new Error(error.message);
  return {
    reglages: { teintes: { ...(data?.teintes ?? {}) }, opacite: data?.opacite_encre ?? OPACITE_ENCRE },
    dtfUrl: urlPublique(svc, data?.dtf_path ?? null),
  };
}

export interface LigneGabarit {
  id: string; modele: string; couleur: string; face: Face;
  photo_path: string; ombres_clair_path: string | null; ombres_sombre_path: string | null; masque_path: string | null;
  ombres_clair_intensite: number; ombres_sombre_intensite: number;
  cadre_x: number; cadre_y: number; cadre_hauteur: number;
  poitrine_x: number | null; poitrine_y: number | null;
}

export function versGabarit(svc: SupabaseClient, l: LigneGabarit): Gabarit {
  return {
    id: l.id, modele: l.modele, couleur: l.couleur, face: l.face,
    photo_url: urlPublique(svc, l.photo_path)!,
    ombres: { CLAIR: urlPublique(svc, l.ombres_clair_path), SOMBRE: urlPublique(svc, l.ombres_sombre_path) },
    masque_url: urlPublique(svc, l.masque_path),
    intensites: { CLAIR: l.ombres_clair_intensite, SOMBRE: l.ombres_sombre_intensite },
    cadre: { x: l.cadre_x, y: l.cadre_y, hauteur: l.cadre_hauteur },
    poitrine: l.poitrine_x !== null && l.poitrine_y !== null ? { x: l.poitrine_x, y: l.poitrine_y } : null,
  };
}

export async function lireGabarits(svc: SupabaseClient, shopId: string): Promise<{ lignes: LigneGabarit[]; gabarits: Gabarit[] }> {
  const { data, error } = await svc.from('mockup_gabarits').select('*').eq('shop_id', shopId).order('modele').order('couleur').order('face');
  if (error) throw new Error(error.message);
  const lignes = (data ?? []) as LigneGabarit[];
  return { lignes, gabarits: lignes.map((l) => versGabarit(svc, l)) };
}

export interface ProduitLu {
  produit: { id: string; title: string; shopify_id: string };
  variantes: VarianteImpression[];
  stockParCouleur: Record<string, number>;
}

/** Un produit du shop et ses variantes actives, avec leurs métachamps d'impression ; `null` s'il n'est pas au shop. */
export async function lireProduit(svc: SupabaseClient, shopId: string, productId: string): Promise<ProduitLu | null> {
  const { data: produit } = await svc.from('products').select('id, title, shopify_id')
    .eq('shop_id', shopId).eq('id', productId).maybeSingle();
  if (!produit) return null;

  const { data: lignes, error } = await svc.from('product_variants')
    .select('id, shopify_id, sku, option1, option2, variant_metafields(key, value), inventory_levels(quantity)')
    .eq('product_id', produit.id).eq('shopify_active', true)
    .in('variant_metafields.key', Object.values(METACHAMPS));
  if (error) throw new Error(error.message);

  const variantes: VarianteImpression[] = [];
  const stockParCouleur: Record<string, number> = {}; // prévient avant de retirer une couleur qui a encore des pièces
  for (const v of lignes ?? []) {
    const mf = (cle: string) => v.variant_metafields.find((m) => m.key === cle)?.value ?? null;
    const couleur = v.option1 ?? '';
    variantes.push({
      id: v.id, shopifyId: v.shopify_id, couleur, tailleVetement: v.option2, sku: v.sku,
      recto: mf(METACHAMPS.recto), verso: mf(METACHAMPS.verso), taille: lireTaille(mf(METACHAMPS.taille)),
    });
    stockParCouleur[couleur] = (stockParCouleur[couleur] ?? 0) + v.inventory_levels.reduce((s, l) => s + Math.max(0, l.quantity ?? 0), 0);
  }
  return { produit, variantes, stockParCouleur };
}

/** Fiche de tailles et fichiers déposés d'un motif (clé = `cleMotif`). */
export async function lireMotif(svc: SupabaseClient, shopId: string, cle: string): Promise<FicheMotif & { fichiers: Partial<Record<Role, FichierDepose>> }> {
  const [{ data, error }, fichiers] = await Promise.all([
    svc.from('mockup_motifs').select('hauteurs').eq('shop_id', shopId).eq('nom', cle).maybeSingle(),
    fichiersDuMotif(svc, dossierMotif(shopId, cle)),
  ]);
  if (error) throw new Error(error.message);
  return { nom: cle, hauteurs: data?.hauteurs ?? {}, fichiers };
}
