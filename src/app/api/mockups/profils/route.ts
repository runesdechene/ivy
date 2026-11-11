import { NextRequest, NextResponse } from 'next/server';
import { autoriser, erreur } from '@/lib/mockups/serveur';
import { lireTaille, type Profil, type TailleImpression } from '@/lib/mockups/regles';

/** Profils de tailles : pour un modèle, la taille d'impression de chaque taille de vêtement. */

const COLONNES = 'id, modele, nom, grille';

export async function GET(request: NextRequest) {
  const acces = await autoriser(request, request.nextUrl.searchParams.get('shopId'));
  if (!acces.ok) return acces.reponse;
  const { data, error } = await acces.auth.svc.from('mockup_profils').select(COLONNES)
    .eq('shop_id', acces.shopId).order('modele').order('nom');
  if (error) return erreur(error.message, 500);
  return NextResponse.json({ profils: data as Profil[] });
}

/** Crée (sans `id`) ou met à jour un profil. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { shopId?: string; profil?: Partial<Profil> } | null;
  const acces = await autoriser(request, body?.shopId);
  if (!acces.ok) return acces.reponse;
  const p = body?.profil;
  const modele = p?.modele?.trim();
  const nom = p?.nom?.trim();
  if (!modele || !nom || typeof p?.grille !== 'object' || !p.grille) return erreur('Modèle, nom et grille requis');

  const grille: Record<string, TailleImpression> = {};
  for (const [taille, valeur] of Object.entries(p.grille)) {
    const t = lireTaille(valeur);
    if (!t) return erreur(`Taille d’impression inconnue : ${valeur}`);
    grille[taille] = t;
  }
  if (Object.keys(grille).length === 0) return erreur('Grille vide');

  const ligne = { shop_id: acces.shopId, modele, nom, grille };
  const table = acces.auth.svc.from('mockup_profils');
  const { data, error } = p.id
    ? await table.update(ligne).eq('id', p.id).eq('shop_id', acces.shopId).select(COLONNES).single()
    : await table.insert(ligne).select(COLONNES).single();
  if (error?.code === '23505') return erreur(`Un profil « ${nom} » existe déjà pour ${modele}`, 409);
  if (error) return erreur(error.message, 500);
  return NextResponse.json({ profil: data as Profil });
}

export async function DELETE(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const acces = await autoriser(request, params.get('shopId'));
  if (!acces.ok) return acces.reponse;
  const { error } = await acces.auth.svc.from('mockup_profils').delete()
    .eq('id', params.get('id') ?? '').eq('shop_id', acces.shopId);
  if (error) return erreur(error.message, 500);
  return NextResponse.json({ ok: true });
}
