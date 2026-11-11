import { NextRequest, NextResponse } from 'next/server';
import { autoriser, erreur, urlPublique } from '@/lib/mockups/serveur';
import { genererMockup } from '@/lib/mockups/generer';
import type { Face } from '@/lib/mockups/regles';

export const maxDuration = 26; // une image par appel : bien en dessous

/** Les mockups enregistrés d'un produit. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const acces = await autoriser(request, params.get('shopId'));
  if (!acces.ok) return acces.reponse;
  const { svc } = acces.auth;
  const { data, error } = await svc.from('mockups').select('couleur, face, image_path, updated_at, envoye_le')
    .eq('shop_id', acces.shopId).eq('product_id', params.get('productId') ?? '');
  if (error) return erreur(error.message, 500);
  return NextResponse.json({
    mockups: (data ?? []).map((m) => ({ couleur: m.couleur, face: m.face as Face, image_url: urlPublique(svc, m.image_path)!, updated_at: m.updated_at, envoye_le: m.envoye_le })),
  });
}

/** Monte et enregistre un mockup (produit × couleur × face). Appelé par l'onglet Générer et par `pnpm mockups`. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { shopId?: string; productId?: string; couleur?: string; face?: Face } | null;
  const acces = await autoriser(request, body?.shopId);
  if (!acces.ok) return acces.reponse;
  if (!body?.productId || !body.couleur || (body.face !== 'recto' && body.face !== 'verso')) return erreur('productId, couleur et face requis');
  try {
    return NextResponse.json(await genererMockup(acces.auth.svc, acces.shopId, body.productId, body.couleur, body.face));
  } catch (e) {
    return erreur((e as Error).message, 500);
  }
}
