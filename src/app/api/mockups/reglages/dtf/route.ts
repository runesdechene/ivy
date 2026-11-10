import { NextRequest, NextResponse } from 'next/server';
import { autoriser, deposerImage, erreur, retirer, urlPublique } from '@/lib/mockups/serveur';

/** Remplace le logo DTF commun (cœur des vestes zippées). */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const shopId = form?.get('shopId');
  const acces = await autoriser(request, typeof shopId === 'string' ? shopId : null);
  if (!acces.ok) return acces.reponse;
  const { svc } = acces.auth;

  const fichier = form?.get('file');
  if (!(fichier instanceof File) || !/\.png$/i.test(fichier.name)) return erreur('Un PNG est attendu');

  const { data: avant } = await svc.from('mockup_reglages').select('dtf_path').eq('shop_id', acces.shopId).maybeSingle();
  let path: string;
  try {
    path = await deposerImage(svc, acces.shopId, 'reglages', fichier);
  } catch (e) {
    return erreur((e as Error).message);
  }
  const { error } = await svc.from('mockup_reglages')
    .upsert({ shop_id: acces.shopId, dtf_path: path, updated_at: new Date().toISOString() }, { onConflict: 'shop_id' });
  if (error) {
    await retirer(svc, [path]);
    return erreur(error.message, 500);
  }
  await retirer(svc, [avant?.dtf_path]);
  return NextResponse.json({ dtf_url: urlPublique(svc, path) });
}
