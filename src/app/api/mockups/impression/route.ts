import { NextRequest, NextResponse } from 'next/server';
import { autoriser, erreur } from '@/lib/mockups/serveur';
import { fichierImpression } from '@/lib/mockups/generer';

export const maxDuration = 26; // un fichier par appel

/** Un fichier d'impression d'un produit, en PNG 300 dpi (`nom` donné par `fichiersImpression`). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const acces = await autoriser(request, params.get('shopId'));
  if (!acces.ok) return acces.reponse;
  const productId = params.get('productId'), nom = params.get('nom');
  if (!productId || !nom) return erreur('productId et nom requis');
  try {
    const png = await fichierImpression(acces.auth.svc, acces.shopId, productId, nom);
    if (!png) return erreur('Fichier impossible à fabriquer : source, teinte ou hauteur manquante', 404);
    return new NextResponse(new Blob([png as BlobPart], { type: 'image/png' }), {
      headers: { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nom)}` },
    });
  } catch (e) {
    return erreur((e as Error).message, 500);
  }
}
