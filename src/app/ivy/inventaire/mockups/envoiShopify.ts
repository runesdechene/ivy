import { authFetch, authJson } from '@/lib/auth-fetch';

export interface BilanEnvoi { envoyees: number; rattachees: number; retirees: number }

/**
 * Envoie les mockups enregistrés d'un produit sur Shopify. Avec `remplacer`, les anciennes photos ne sont retirées
 * qu'une fois les nouvelles traitées par Shopify (la route répond 409 tant qu'elles ne le sont pas).
 */
export async function envoyerSurShopify(
  shopId: string, productId: string, options: { remplacer: boolean; rattacher: boolean }, etape?: (texte: string) => void,
): Promise<BilanEnvoi> {
  etape?.('Envoi…');
  const r = await authJson<{ anciens: string[]; nouveaux: string[]; envoyees: number; rattachees: number }>('/api/mockups/shopify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shopId, productId, rattacher: options.rattacher }),
  });
  if (!options.remplacer || r.anciens.length === 0) return { envoyees: r.envoyees, rattachees: r.rattachees, retirees: 0 };

  for (let essai = 1; ; essai++) {
    etape?.(`Traitement chez Shopify… (${essai})`);
    const p = await authFetch('/api/mockups/shopify', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shopId, productId, anciens: r.anciens, nouveaux: r.nouveaux }),
    });
    const corps = await p.json() as { supprimees?: number; error?: string };
    if (p.ok) return { envoyees: r.envoyees, rattachees: r.rattachees, retirees: corps.supprimees ?? 0 };
    if (p.status !== 409 || essai >= 15) throw new Error(corps.error ?? 'Remplacement interrompu : les anciennes photos sont gardées');
    await new Promise((ok) => setTimeout(ok, 2000));
  }
}
