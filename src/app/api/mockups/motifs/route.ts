import { NextRequest, NextResponse } from 'next/server';
import { autoriser, erreur, dossierMotif, fichiersDuMotif } from '@/lib/mockups/serveur';
import { cleMotif, CADRE_HAUTEUR_CM, TAILLES_IMPRESSION, type FicheMotif, type Motif } from '@/lib/mockups/regles';

/** Les motifs : ceux des titres de produits (« Loki | … ») et ceux qui ont déjà une fiche, avec leurs fichiers déposés. */
export async function GET(request: NextRequest) {
  const acces = await autoriser(request, request.nextUrl.searchParams.get('shopId'));
  if (!acces.ok) return acces.reponse;
  const { svc } = acces.auth;

  const [produits, fiches] = await Promise.all([
    svc.from('products').select('title').eq('shop_id', acces.shopId).eq('status', 'active').like('title', '% | %'),
    svc.from('mockup_motifs').select('nom, hauteurs, axe').eq('shop_id', acces.shopId),
  ]);
  if (produits.error || fiches.error) return erreur((produits.error ?? fiches.error)!.message, 500);

  const motifs = new Map<string, Omit<Motif, 'fichiers'>>();
  for (const { title } of produits.data) {
    const libelle = title.slice(0, title.indexOf(' | ')).trim();
    const nom = cleMotif(libelle);
    const m = motifs.get(nom) ?? { nom, libelle, hauteurs: {}, produits: 0 };
    m.produits++;
    motifs.set(nom, m);
  }
  for (const f of fiches.data as FicheMotif[]) {
    motifs.set(f.nom, { ...(motifs.get(f.nom) ?? { nom: f.nom, libelle: f.nom, produits: 0 }), hauteurs: f.hauteurs, axe: f.axe ?? null });
  }

  const liste: Motif[] = await Promise.all([...motifs.values()].map(async (m) => ({
    ...m, fichiers: await fichiersDuMotif(svc, dossierMotif(acces.shopId, m.nom)),
  })));
  liste.sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr'));
  return NextResponse.json({ motifs: liste });
}

/** Enregistre la fiche de tailles d'un motif (vide pour un nouveau motif) : hauteurs en cm, chacune > 0 et ≤ 49,5. */
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null) as { shopId?: string; fiche?: FicheMotif } | null;
  const acces = await autoriser(request, body?.shopId);
  if (!acces.ok) return acces.reponse;

  const nom = cleMotif(body?.fiche?.nom ?? '');
  const hauteurs = body?.fiche?.hauteurs;
  const axe = body?.fiche?.axe ?? null;
  if (!nom) return erreur('Nom du motif manquant');
  if (!hauteurs || typeof hauteurs !== 'object') return erreur('Hauteurs manquantes');
  for (const [taille, cm] of Object.entries(hauteurs)) {
    if (!(TAILLES_IMPRESSION as string[]).includes(taille)) return erreur(`Taille inconnue : ${taille}`);
    if (typeof cm !== 'number' || !(cm > 0 && cm <= CADRE_HAUTEUR_CM)) return erreur(`Hauteur invalide pour ${taille}`);
  }

  if (axe !== null && !(typeof axe === 'number' && axe > 0 && axe < 1)) return erreur('Axe invalide');

  const { error } = await acces.auth.svc.from('mockup_motifs')
    .upsert({ shop_id: acces.shopId, nom, hauteurs, axe, updated_at: new Date().toISOString() }, { onConflict: 'shop_id,nom' });
  if (error) return erreur(error.message, 500);
  return NextResponse.json({ ok: true });
}
