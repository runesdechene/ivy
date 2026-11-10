import { NextRequest, NextResponse } from 'next/server';
import { autoriser, erreur } from '@/lib/mockups/serveur';
import { cleMotif, CADRE_HAUTEUR_CM, TAILLES_IMPRESSION, type FicheMotif } from '@/lib/mockups/regles';

export async function GET(request: NextRequest) {
  const acces = await autoriser(request, request.nextUrl.searchParams.get('shopId'));
  if (!acces.ok) return acces.reponse;
  const { data, error } = await acces.auth.svc.from('mockup_motifs').select('nom, hauteurs').eq('shop_id', acces.shopId).order('nom');
  if (error) return erreur(error.message, 500);
  return NextResponse.json({ fiches: data as FicheMotif[] });
}

/** Enregistre la fiche de tailles d'un motif : hauteurs en cm, chacune > 0 et ≤ 49,5. */
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null) as { shopId?: string; fiche?: FicheMotif } | null;
  const acces = await autoriser(request, body?.shopId);
  if (!acces.ok) return acces.reponse;

  const nom = cleMotif(body?.fiche?.nom ?? '');
  const hauteurs = body?.fiche?.hauteurs;
  if (!nom) return erreur('Nom du motif manquant');
  if (!hauteurs || typeof hauteurs !== 'object') return erreur('Hauteurs manquantes');
  for (const [taille, cm] of Object.entries(hauteurs)) {
    if (!(TAILLES_IMPRESSION as string[]).includes(taille)) return erreur(`Taille inconnue : ${taille}`);
    if (typeof cm !== 'number' || !(cm > 0 && cm <= CADRE_HAUTEUR_CM)) return erreur(`Hauteur invalide pour ${taille}`);
  }

  const { error } = await acces.auth.svc.from('mockup_motifs')
    .upsert({ shop_id: acces.shopId, nom, hauteurs, updated_at: new Date().toISOString() }, { onConflict: 'shop_id,nom' });
  if (error) return erreur(error.message, 500);
  return NextResponse.json({ ok: true });
}
