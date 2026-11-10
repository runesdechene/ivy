import { NextRequest, NextResponse } from 'next/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { autoriser, deposerImage, erreur, retirer, toutesLesLignes, urlPublique } from '@/lib/mockups/serveur';
import type { Face, Gabarit } from '@/lib/mockups/regles';

interface LigneGabarit {
  id: string; modele: string; couleur: string; face: Face;
  photo_path: string; ombres_clair_path: string | null; ombres_sombre_path: string | null;
  cadre_x: number; cadre_y: number; cadre_hauteur: number;
  poitrine_x: number | null; poitrine_y: number | null;
}

function versGabarit(svc: SupabaseClient, l: LigneGabarit): Gabarit {
  return {
    id: l.id, modele: l.modele, couleur: l.couleur, face: l.face,
    photo_url: urlPublique(svc, l.photo_path)!,
    ombres: { CLAIR: urlPublique(svc, l.ombres_clair_path), SOMBRE: urlPublique(svc, l.ombres_sombre_path) },
    cadre: { x: l.cadre_x, y: l.cadre_y, hauteur: l.cadre_hauteur },
    poitrine: l.poitrine_x !== null && l.poitrine_y !== null ? { x: l.poitrine_x, y: l.poitrine_y } : null,
  };
}

/** Modèles (SKU) de la boutique et leurs couleurs (option1). */
async function modelesDuShop(svc: SupabaseClient, shopId: string): Promise<Record<string, string[]>> {
  const lignes = await toutesLesLignes<{ sku: string | null; option1: string | null }>((de, a) =>
    svc.from('product_variants')
      .select('sku, option1, products!inner(shop_id)')
      .eq('products.shop_id', shopId)
      .not('sku', 'is', null)
      .range(de, a));
  const modeles: Record<string, Set<string>> = {};
  for (const { sku, option1 } of lignes) {
    const modele = sku?.trim();
    if (!modele) continue;
    (modeles[modele] ??= new Set());
    if (option1) modeles[modele].add(option1);
  }
  return Object.fromEntries(Object.entries(modeles).map(([m, c]) => [m, [...c].sort()]));
}

export async function GET(request: NextRequest) {
  const acces = await autoriser(request, request.nextUrl.searchParams.get('shopId'));
  if (!acces.ok) return acces.reponse;
  const { svc } = acces.auth;

  const { data, error } = await svc.from('mockup_gabarits').select('*').eq('shop_id', acces.shopId).order('modele').order('couleur').order('face');
  if (error) return erreur(error.message, 500);
  try {
    return NextResponse.json({
      gabarits: (data as LigneGabarit[]).map((l) => versGabarit(svc, l)),
      modeles: await modelesDuShop(svc, acces.shopId),
    });
  } catch (e) {
    return erreur((e as Error).message, 500);
  }
}

const nombre = (v: FormDataEntryValue | null) => (typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const texte = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v.trim() : '');
const fichier = (v: FormDataEntryValue | null) => (v instanceof File && v.size > 0 ? v : null);

/** Crée ou met à jour le gabarit (modèle × couleur × face). Les fichiers fournis remplacent les anciens. */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  if (!form) return erreur('Formulaire attendu');
  const acces = await autoriser(request, texte(form.get('shopId')));
  if (!acces.ok) return acces.reponse;
  const { svc } = acces.auth;

  const modele = texte(form.get('modele'));
  const couleur = texte(form.get('couleur'));
  const face = texte(form.get('face'));
  const cadre_x = nombre(form.get('cadre_x'));
  const cadre_y = nombre(form.get('cadre_y'));
  const cadre_hauteur = nombre(form.get('cadre_hauteur'));
  const poitrine_x = nombre(form.get('poitrine_x'));
  const poitrine_y = nombre(form.get('poitrine_y'));
  if (!modele || !couleur) return erreur('Modèle et couleur requis');
  if (face !== 'recto' && face !== 'verso') return erreur('Face invalide');
  if (cadre_x === null || cadre_y === null || cadre_hauteur === null || cadre_hauteur <= 0) return erreur('Cadre invalide');

  const { data: avant } = await svc.from('mockup_gabarits')
    .select('photo_path, ombres_clair_path, ombres_sombre_path')
    .eq('shop_id', acces.shopId).eq('modele', modele).eq('couleur', couleur).eq('face', face)
    .maybeSingle();

  const envois = { photo_path: fichier(form.get('photo')), ombres_clair_path: fichier(form.get('ombres_clair')), ombres_sombre_path: fichier(form.get('ombres_sombre')) };
  if (!avant && !envois.photo_path) return erreur('Photo requise pour un nouveau gabarit');

  // Ombres retirées sans remplacement : la colonne repasse à null, le fichier part après l'écriture.
  const retraits: Partial<Record<keyof typeof envois, null>> = {};
  if (form.get('retirer_ombres_clair') === '1' && !envois.ombres_clair_path) retraits.ombres_clair_path = null;
  if (form.get('retirer_ombres_sombre') === '1' && !envois.ombres_sombre_path) retraits.ombres_sombre_path = null;

  // Dépose d'abord les nouveaux fichiers ; on ne supprime les anciens qu'une fois la ligne écrite.
  const nouveaux: Partial<Record<keyof typeof envois, string>> = {};
  try {
    for (const [colonne, f] of Object.entries(envois) as [keyof typeof envois, File | null][]) {
      if (f) nouveaux[colonne] = await deposerImage(svc, acces.shopId, 'gabarits', f);
    }
  } catch (e) {
    await retirer(svc, Object.values(nouveaux));
    return erreur((e as Error).message);
  }

  const { data, error } = await svc.from('mockup_gabarits').upsert({
    shop_id: acces.shopId, modele, couleur, face, cadre_x, cadre_y, cadre_hauteur,
    poitrine_x: face === 'recto' ? poitrine_x : null,
    poitrine_y: face === 'recto' ? poitrine_y : null,
    // L'upsert insère une ligne complète avant de détecter le conflit : on repart des fichiers existants.
    ...avant,
    ...retraits,
    ...nouveaux,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'shop_id,modele,couleur,face' }).select('*').single();
  if (error) {
    await retirer(svc, Object.values(nouveaux));
    return erreur(error.message, 500);
  }
  if (avant) await retirer(svc, (Object.keys({ ...nouveaux, ...retraits }) as (keyof typeof envois)[]).map((c) => avant[c]));
  return NextResponse.json({ gabarit: versGabarit(svc, data as LigneGabarit) });
}

export async function DELETE(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const acces = await autoriser(request, params.get('shopId'));
  if (!acces.ok) return acces.reponse;
  const { svc } = acces.auth;

  const { data, error } = await svc.from('mockup_gabarits').delete()
    .eq('shop_id', acces.shopId).eq('id', params.get('id') ?? '')
    .select('photo_path, ombres_clair_path, ombres_sombre_path').maybeSingle();
  if (error) return erreur(error.message, 500);
  if (!data) return erreur('Gabarit introuvable', 404);
  await retirer(svc, [data.photo_path, data.ombres_clair_path, data.ombres_sombre_path]);
  return NextResponse.json({ ok: true });
}
