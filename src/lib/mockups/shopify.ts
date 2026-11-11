/** Côté serveur : appel GraphQL à l'Admin API Shopify d'une boutique. Lève sur `errors` et sur `userErrors`. */
export async function shopifyGraphql<T>(
  shop: { shopify_url: string; shopify_token: string }, query: string, variables: object,
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
