import type { SupabaseClient } from '@supabase/supabase-js';

export type Boutique = { shopify_url: string; shopify_token: string };

/** Adresse et jeton Shopify d'une boutique ; lève si elle n'a pas de jeton. */
export async function boutique(svc: SupabaseClient, shopId: string): Promise<Boutique> {
  const { data } = await svc.from('shops').select('shopify_url, shopify_token').eq('id', shopId).single();
  if (!data?.shopify_token) throw new Error('Boutique sans jeton Shopify');
  return data;
}

/** Côté serveur : appel GraphQL à l'Admin API Shopify d'une boutique. Lève sur `errors` et sur `userErrors`. */
export async function shopifyGraphql<T>(
  shop: Boutique, query: string, variables: object,
): Promise<T> {
  const r = await fetch(`https://${shop.shopify_url}/admin/api/2026-10/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': shop.shopify_token },
    body: JSON.stringify({ query, variables }),
  });
  const corps = await r.json() as { data?: T; errors?: { message: string }[] };
  if (!r.ok || corps.errors?.length) throw new Error(corps.errors?.map((e) => e.message).join(' ; ') || `Shopify ${r.status}`);
  // Chaque mutation renvoie ses propres userErrors : on les remonte toutes.
  const erreurs = Object.values(corps.data ?? {}).flatMap((v) => (v as { userErrors?: { message: string }[] })?.userErrors ?? []);
  if (erreurs.length) throw new Error(erreurs.map((e) => e.message).join(' ; '));
  return corps.data as T;
}
