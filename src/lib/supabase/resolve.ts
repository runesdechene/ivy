import type { SupabaseClient } from '@supabase/supabase-js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Résout un identifiant de variante (UUID Supabase OU Shopify ID numérique en string)
 * vers son UUID Supabase. Retourne null si introuvable.
 */
export async function resolveVariantId(
  supabase: SupabaseClient,
  variantId: string,
): Promise<string | null> {
  if (isUuid(variantId)) return variantId;

  const { data } = await supabase
    .from('product_variants')
    .select('id')
    .eq('shopify_id', variantId)
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
