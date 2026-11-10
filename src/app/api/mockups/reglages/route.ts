import { NextRequest, NextResponse } from 'next/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { autoriser, erreur, toutesLesLignes, urlPublique } from '@/lib/mockups/serveur';
import { lireImpression, METACHAMPS, OPACITE_ENCRE, type Reglages } from '@/lib/mockups/regles';

/** Teintes présentes dans les métachamps recto/verso des variantes de la boutique. */
async function teintesUtilisees(svc: SupabaseClient, shopId: string): Promise<Set<string>> {
  const lignes = await toutesLesLignes<{ key: string; value: string }>((de, a) =>
    svc.from('variant_metafields')
      .select('key, value, product_variants!inner(products!inner(shop_id))')
      .in('key', [METACHAMPS.recto, METACHAMPS.verso])
      .eq('product_variants.products.shop_id', shopId)
      .range(de, a));
  const teintes = new Set<string>();
  for (const l of lignes) {
    const impression = lireImpression(l.value, l.key === METACHAMPS.verso ? 'verso' : 'recto');
    if (impression) teintes.add(impression.teinte);
  }
  return teintes;
}

export async function GET(request: NextRequest) {
  const acces = await autoriser(request, request.nextUrl.searchParams.get('shopId'));
  if (!acces.ok) return acces.reponse;
  const { svc } = acces.auth;

  const { data, error } = await svc.from('mockup_reglages').select('teintes, dtf_path, opacite_encre').eq('shop_id', acces.shopId).maybeSingle();
  if (error) return erreur(error.message, 500);

  const reglages: Reglages = { teintes: { ...(data?.teintes ?? {}) }, opacite: data?.opacite_encre ?? OPACITE_ENCRE };
  try {
    for (const code of await teintesUtilisees(svc, acces.shopId)) {
      reglages.teintes[code] ??= { couleur: null, version: null };
    }
  } catch (e) {
    return erreur((e as Error).message, 500);
  }
  return NextResponse.json({ reglages, dtf_url: urlPublique(svc, data?.dtf_path ?? null) });
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null) as { shopId?: string; reglages?: Reglages } | null;
  const acces = await autoriser(request, body?.shopId);
  if (!acces.ok) return acces.reponse;

  const teintes = body?.reglages?.teintes;
  if (!teintes || typeof teintes !== 'object') return erreur('Réglages manquants');
  for (const [code, t] of Object.entries(teintes)) {
    if (!/^[A-Z0-9]{1,10}$/.test(code)) return erreur(`Code de teinte invalide : ${code}`);
    if (t.couleur !== null && !/^#[0-9a-f]{6}$/i.test(t.couleur)) return erreur(`Couleur invalide pour ${code}`);
    if (t.version !== null && t.version !== 'CLAIR' && t.version !== 'SOMBRE') return erreur(`Version invalide pour ${code}`);
  }

  const opacite = body?.reglages?.opacite;
  if (typeof opacite !== 'number' || !(opacite > 0 && opacite <= 1)) return erreur('Opacité invalide (entre 1 et 100 %)');

  const { error } = await acces.auth.svc.from('mockup_reglages')
    .upsert({ shop_id: acces.shopId, teintes, opacite_encre: opacite, updated_at: new Date().toISOString() }, { onConflict: 'shop_id' });
  if (error) return erreur(error.message, 500);
  return NextResponse.json({ ok: true });
}
