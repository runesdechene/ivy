import type { SupabaseClient } from '@supabase/supabase-js';
import { validerCaisses, validerMateriel, type ObjetMateriel } from './materiel';
import { loadReferentiel, tarifsDuPassage } from './tariffs';

/**
 * Modèle douanier d'un emplacement : caisses par type et matériel d'exposition.
 *
 * Même règle que le référentiel des libellés : un passage OUVERT lit le modèle
 * en direct (on ne saisit qu'à un endroit, Paramètres → Douane) ; à la clôture,
 * les valeurs sont figées dans le passage.
 */
export interface ModeleEmplacement {
  packaging_kg: Record<string, number>;
  materiel: ObjetMateriel[];
}

export async function loadModele(
  supabase: SupabaseClient,
  shopId: string,
  locationId: string,
): Promise<ModeleEmplacement | null> {
  const { data, error } = await supabase
    .from('customs_location_templates')
    .select('packaging_kg, materiel')
    .eq('shop_id', shopId)
    .eq('location_id', locationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  // Relu à travers les mêmes contrôles qu'à l'écriture : une donnée abîmée en
  // base ne doit pas finir sur une feuille remise à la douane.
  const materiel = validerMateriel(data.materiel);
  return {
    packaging_kg: validerCaisses(data.packaging_kg) ?? {},
    materiel: 'materiel' in materiel ? materiel.materiel : [],
  };
}

/**
 * Caisses et matériel à utiliser pour un passage.
 * Ouvert : ceux du modèle (à défaut de modèle, la copie faite à la création).
 * Clôturé : ceux figés dans le passage.
 */
export function modeleDuPassage(
  passage: { status: string; packaging_kg?: Record<string, number> | null; materiel?: ObjetMateriel[] | null },
  modele: ModeleEmplacement | null,
): ModeleEmplacement {
  // Les caisses par type sont remplacées par les fournitures cochées « Caisse » :
  // un passage ouvert n'hérite plus de l'ancienne grille du modèle.
  if (passage.status !== 'closed' && modele) return { packaging_kg: {}, materiel: modele.materiel };
  return { packaging_kg: passage.packaging_kg ?? {}, materiel: passage.materiel ?? [] };
}

interface PassageResolvable {
  shop_id: string;
  location_id: string;
  status: string;
  customs_labels?: Record<string, string> | null;
  tariff_by_type?: Record<string, { position?: string; origine?: string; tva?: number }> | null;
  packaging_kg?: Record<string, number> | null;
  materiel?: ObjetMateriel[] | null;
}

/**
 * Tout ce qu'un passage lit ailleurs que dans sa propre ligne : libellés et codes
 * SH (référentiel), caisses et matériel (modèle de l'emplacement). Utilisé par la
 * page, la feuille imprimée et la clôture, pour qu'ils disent tous la même chose.
 */
export async function resoudrePassage<T extends PassageResolvable>(supabase: SupabaseClient, passage: T) {
  const [referentiel, modele] = await Promise.all([
    loadReferentiel(supabase, passage.shop_id),
    loadModele(supabase, passage.shop_id, passage.location_id),
  ]);
  return {
    ...passage,
    ...tarifsDuPassage(passage, referentiel),
    ...modeleDuPassage(passage, modele),
  };
}
