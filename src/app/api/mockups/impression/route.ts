import { NextRequest, NextResponse } from 'next/server';
import { autoriser, erreur } from '@/lib/mockups/serveur';
import { adresseImpression, fichiersDesLignes, fichiersDuMotifAImprimer, type LigneAImprimer } from '@/lib/mockups/generer';

export const maxDuration = 26; // un fichier fabriqué par appel

/**
 * Fichiers d'impression (PNG 300 dpi) :
 * - GET `motif` + `nom` (+ `recto`, `verso`, `taille`) → `{ url }`, adresse signée du fichier, fabriqué s'il n'est pas gardé ;
 * - GET `motif` seul → `{ fichiers }`, toutes les demandes du motif, pour les refaire d'un coup ;
 * - POST `{ shopId, lignes }` → `{ lignes }`, les fichiers de chaque ligne d'une commande, d'après son impression figée.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const acces = await autoriser(request, params.get('shopId'));
  if (!acces.ok) return acces.reponse;
  const motif = params.get('motif'), nom = params.get('nom');
  if (!motif) return erreur('motif requis');
  try {
    if (!nom) return NextResponse.json({ fichiers: await fichiersDuMotifAImprimer(acces.auth.svc, acces.shopId, motif) });
    const url = await adresseImpression(acces.auth.svc, acces.shopId, {
      motif, nom, recto: params.get('recto'), verso: params.get('verso'), taille: params.get('taille'),
    });
    if (!url) return erreur('Fichier impossible à fabriquer : source, teinte ou hauteur manquante', 404);
    return NextResponse.json({ url });
  } catch (e) {
    return erreur((e as Error).message, 500);
  }
}

export async function POST(request: NextRequest) {
  const corps = await request.json().catch(() => null) as { shopId?: string; lignes?: LigneAImprimer[] } | null;
  const acces = await autoriser(request, corps?.shopId);
  if (!acces.ok) return acces.reponse;
  if (!Array.isArray(corps?.lignes)) return erreur('lignes requises');
  try {
    return NextResponse.json({ lignes: await fichiersDesLignes(acces.auth.svc, acces.shopId, corps.lignes) });
  } catch (e) {
    return erreur((e as Error).message, 500);
  }
}
