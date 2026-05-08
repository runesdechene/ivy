import type { SupabaseClient } from '@supabase/supabase-js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Extrait l'ID numérique d'un GID Shopify (`gid://shopify/.../N` → `N`).
 * Si l'entrée n'est pas un GID, retourne tel quel.
 */
function stripShopifyGid(value: string): string {
  return value.startsWith('gid://') ? (value.split('/').pop() ?? value) : value;
}

/**
 * Résout un identifiant de variante vers son UUID Supabase. Accepte :
 * - UUID Supabase (retourné tel quel)
 * - Shopify ID numérique en string (lookup `shopify_id`)
 * - GID Shopify `gid://shopify/ProductVariant/N` (strip puis lookup `shopify_id`)
 *
 * Retourne null si introuvable.
 */
export async function resolveVariantId(
  supabase: SupabaseClient,
  variantId: string,
): Promise<string | null> {
  if (isUuid(variantId)) return variantId;

  const shopifyId = stripShopifyGid(variantId);

  const { data } = await supabase
    .from('product_variants')
    .select('id')
    .eq('shopify_id', shopifyId)
    .maybeSingle();

  return data?.id ?? null;
}

/**
 * Résout un identifiant de location (UUID Supabase OU Shopify numeric string)
 * vers son UUID Supabase. Indispensable pour `stock_movements.location_id` qui est
 * une FK UUID vers `locations(id)`. Retourne null si introuvable.
 */
export async function resolveLocationUuid(
  supabase: SupabaseClient,
  locationId: string,
): Promise<string | null> {
  if (isUuid(locationId)) return locationId;

  const { data } = await supabase
    .from('locations')
    .select('id')
    .eq('shopify_id', locationId)
    .maybeSingle();

  return data?.id ?? null;
}

/**
 * Résout un UUID location vers son Shopify ID (TEXT). Inverse de resolveLocationUuid.
 * Utile pour les appels Shopify Admin API.
 */
export async function resolveLocationShopifyId(
  supabase: SupabaseClient,
  locationId: string,
): Promise<string | null> {
  if (!isUuid(locationId)) return locationId;

  const { data } = await supabase
    .from('locations')
    .select('shopify_id')
    .eq('id', locationId)
    .maybeSingle();

  return data?.shopify_id ?? null;
}
