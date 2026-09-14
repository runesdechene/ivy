import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Référentiel douanier : un code SH et un libellé par type de produit.
 *
 * Source unique pour un passage OUVERT, lue en direct : corriger un code dans
 * Paramètres → Douane corrige aussitôt la page et la feuille imprimée. À la
 * clôture, les valeurs sont figées dans le passage — un document déjà remis à la
 * douane ne doit plus bouger si le référentiel change ensuite.
 */

export interface TypeTariff {
  /** Position tarifaire sur 8 chiffres, sans point : 61091000. */
  code_sh: string | null;
  /** Mot courant lu par le douanier : « T-shirt coton ». */
  libelle: string | null;
}

export type Referentiel = Record<string, TypeTariff>;

/** 61091000 → 6109.1000, la forme imprimée sur le formulaire. */
export function formatSh(code: string | null | undefined): string {
  if (!code) return '';
  return /^\d{8}$/.test(code) ? `${code.slice(0, 4)}.${code.slice(4)}` : code;
}

/** « 6109.1000 », « 6109 1000 » → 61091000. null si ce n'est pas un code à 8 chiffres. */
export function parseSh(saisie: string): string | null {
  const chiffres = saisie.replace(/\D/g, '');
  return chiffres.length === 8 ? chiffres : null;
}

export async function loadReferentiel(supabase: SupabaseClient, shopId: string): Promise<Referentiel> {
  const { data, error } = await supabase
    .from('customs_type_tariffs')
    .select('product_type, code_sh, libelle')
    .eq('shop_id', shopId);
  if (error) throw new Error(error.message);
  const out: Referentiel = {};
  for (const r of (data ?? []) as ({ product_type: string } & TypeTariff)[]) {
    out[r.product_type] = { code_sh: r.code_sh, libelle: r.libelle };
  }
  return out;
}

type TariffByType = Record<string, { position?: string; origine?: string; tva?: number }>;

/**
 * Libellés et codes SH à utiliser pour un passage.
 *
 * Ouvert : ceux du référentiel, en conservant les autres champs éventuels
 * (origine, TVA) déjà portés par le passage. Clôturé : ceux figés dans le passage.
 */
export function tarifsDuPassage(
  passage: { status: string; customs_labels?: Record<string, string> | null; tariff_by_type?: TariffByType | null },
  referentiel: Referentiel,
): { customs_labels: Record<string, string>; tariff_by_type: TariffByType } {
  if (passage.status === 'closed') {
    return { customs_labels: passage.customs_labels ?? {}, tariff_by_type: passage.tariff_by_type ?? {} };
  }
  const customs_labels: Record<string, string> = {};
  const tariff_by_type: TariffByType = {};
  for (const [type, t] of Object.entries(referentiel)) {
    if (t.libelle) customs_labels[type] = t.libelle;
    const autres = { ...(passage.tariff_by_type?.[type] ?? {}) };
    delete autres.position;
    tariff_by_type[type] = t.code_sh ? { ...autres, position: t.code_sh } : autres;
  }
  return { customs_labels, tariff_by_type };
}
