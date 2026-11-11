import { NextRequest, NextResponse } from 'next/server';
import { autoriser, erreur, deposerSource, dossierMotif } from '@/lib/mockups/serveur';
import { cleMotif, roleDuFichier } from '@/lib/mockups/regles';

/** Dépose un ou plusieurs fichiers sources d'un motif ; chacun est rangé d'après la fin de son nom. */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const acces = await autoriser(request, form?.get('shopId')?.toString());
  if (!acces.ok) return acces.reponse;

  const motif = cleMotif(form!.get('motif')?.toString() ?? '');
  if (!motif) return erreur('Motif manquant');
  const fichiers = form!.getAll('files').filter((f): f is File => f instanceof File);
  if (fichiers.length === 0) return erreur('Aucun fichier');

  // Tout vérifier avant d'écrire : un lot refusé ne laisse rien à moitié déposé.
  const roles = fichiers.map((f) => roleDuFichier(f.name));
  const inconnus = fichiers.filter((_, i) => !roles[i]).map((f) => f.name);
  if (inconnus.length) return erreur(`Nom à finir par CLAIR, SOMBRE, MARQUE ou DTF : ${inconnus.join(', ')}`);

  try {
    for (const [i, f] of fichiers.entries()) await deposerSource(acces.auth.svc, dossierMotif(acces.shopId, motif), roles[i]!, f);
  } catch (e) {
    return erreur((e as Error).message);
  }
  return NextResponse.json({ ok: true, roles });
}
