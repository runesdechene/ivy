import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveVariantId, resolveLocationUuid, resolveLocationShopifyId } from '@/lib/supabase/resolve';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface StockAdjustment {
  variantId: string;
  quantity: number; // Negative to decrease, positive to increase
  productTitle?: string;
  variantTitle?: string;
}

interface ItemResult {
  variantId: string;
  success: boolean;
  /** Libellé lisible pour l'alerte côté UI (produit — variante). */
  label?: string;
  error?: string;
  /** true quand l'échec vient de la synchro Shopify (et non du local). */
  shopifyFailed?: boolean;
  /**
   * true = rien n'a été écrit (ni Shopify ni Ivy), la ligne peut être revalidée
   * telle quelle. false = état partiel ou inconnu, revalider risque de compter
   * deux fois — l'UI doit alerter au lieu de remettre la ligne au panier.
   */
  retryable?: boolean;
}

function itemLabel(item: StockAdjustment): string {
  return [item.productTitle, item.variantTitle].filter(Boolean).join(' — ') || item.variantId;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { shopId, locationId, items } = body as {
      shopId: string;
      locationId?: string;
      items: StockAdjustment[];
    };

    if (!shopId || !items || items.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Un même locationId entrant peut être un UUID Supabase OU un ID Shopify
    // numérique (le HUB de stand passe celui du LocationContext, donc Shopify).
    // Les deux formes sont nécessaires, sur des tables différentes :
    //   • stock_movements.location_id  → UUID FK → locations(id)
    //   • inventory_levels.location_id → TEXT, ID Shopify
    // Cf. gotcha "Locations - 2 colonnes location_id divergentes".
    let locationUuid: string | null = null;
    let locationShopifyId: string | null = null;
    if (locationId) {
      locationUuid = await resolveLocationUuid(supabase, locationId);
      locationShopifyId = await resolveLocationShopifyId(supabase, locationId);
    }

    // Get shop for Shopify credentials
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('shopify_url, shopify_token')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      return NextResponse.json(
        { error: 'Shop not found' },
        { status: 404 }
      );
    }

    const results: ItemResult[] = [];
    const today = new Date().toISOString().split('T')[0];
    const movementsToLog: {
      shop_id: string;
      location_id: string | null;
      variant_id: string;
      product_title: string;
      variant_title: string | null;
      quantity: number;
    }[] = [];

    for (const item of items) {
      const label = itemLabel(item);
      try {
        // Resolve variant ID (could be Shopify ID)
        const resolvedVariantId = await resolveVariantId(supabase, item.variantId);
        if (!resolvedVariantId) {
          results.push({ variantId: item.variantId, label, success: false, retryable: true, error: 'Variante introuvable' });
          continue;
        }

        // Get variant with inventory_item_id
        const { data: variant, error: variantError } = await supabase
          .from('product_variants')
          .select('id, inventory_item_id, shopify_active')
          .eq('id', resolvedVariantId)
          .single();

        if (variantError || !variant) {
          results.push({
            variantId: item.variantId,
            label,
            success: false,
            retryable: true,
            error: 'Variante introuvable',
          });
          continue;
        }

        // Shopify AVANT le local : si la synchro échoue, on n'a pas déjà bougé
        // le stock local (sinon Ivy et Shopify divergent en silence).
        //
        // Skip Shopify pour les variantes purement locales :
        //   • pas d'inventory_item_id (n'a jamais existé sur Shopify)
        //   • shopify_active=false (supprimée côté Shopify, l'inventory_item_id
        //     stocké est stale → "inventory item could not be found")
        if (variant.inventory_item_id && variant.shopify_active !== false && locationShopifyId) {
          // POST /inventory_levels/adjust.json (REST) est déprécié et renvoie 404
          // depuis l'API 2024+. On passe par la mutation GraphQL.
          const graphqlEndpoint = `https://${shop.shopify_url}/admin/api/2026-01/graphql.json`;
          const mutation = `
            mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
              inventoryAdjustQuantities(input: $input) {
                userErrors { field message }
                inventoryAdjustmentGroup { id }
              }
            }
          `;

          const variables = {
            input: {
              reason: 'correction',
              name: 'available',
              referenceDocumentUri: `logistics://ivy/pos-adjust/${shopId}/${today}`,
              changes: [
                {
                  delta: item.quantity,
                  inventoryItemId: `gid://shopify/InventoryItem/${variant.inventory_item_id}`,
                  locationId: `gid://shopify/Location/${locationShopifyId}`,
                },
              ],
            },
          };

          const shopifyResponse = await fetch(graphqlEndpoint, {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': shop.shopify_token,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: mutation, variables }),
          });

          const shopifyData = await shopifyResponse.json().catch(() => null);

          if (!shopifyResponse.ok || shopifyData?.errors) {
            console.error('[POS adjust] Shopify GraphQL failed:', {
              status: shopifyResponse.status,
              errors: shopifyData?.errors,
              variantId: resolvedVariantId,
            });
            results.push({
              variantId: item.variantId,
              label,
              success: false,
              shopifyFailed: true,
              retryable: true,
              error: `Shopify a refusé l'ajustement (HTTP ${shopifyResponse.status})`,
            });
            continue;
          }

          const userErrors = shopifyData?.data?.inventoryAdjustQuantities?.userErrors ?? [];
          if (userErrors.length > 0) {
            console.error('[POS adjust] Shopify userErrors:', userErrors, { variantId: resolvedVariantId });
            results.push({
              variantId: item.variantId,
              label,
              success: false,
              shopifyFailed: true,
              retryable: true,
              error: `Shopify : ${userErrors.map((e: { message: string }) => e.message).join(' / ')}`,
            });
            continue;
          }
        }

        // Update local inventory (inventory_levels.location_id = ID Shopify)
        if (locationShopifyId) {
          const { data: currentLevel } = await supabase
            .from('inventory_levels')
            .select('quantity')
            .eq('variant_id', resolvedVariantId)
            .eq('location_id', locationShopifyId)
            .maybeSingle();

          const newQuantity = (currentLevel?.quantity ?? 0) + item.quantity;

          const { error: updateError } = await supabase
            .from('inventory_levels')
            .upsert({
              variant_id: resolvedVariantId,
              location_id: locationShopifyId,
              quantity: newQuantity,
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'variant_id,location_id',
            });

          if (updateError) {
            console.error('[POS adjust] inventory_levels upsert failed:', updateError);
            results.push({
              variantId: item.variantId,
              label,
              success: false,
              retryable: false,
              error:
                variant.inventory_item_id && variant.shopify_active !== false
                  ? 'Shopify est à jour mais PAS le stock Ivy — à corriger à la main, ne pas revalider'
                  : 'Mise à jour du stock local impossible',
            });
            continue;
          }
        }

        // Queue movement for logging (location_id must be UUID, not Shopify ID)
        if (item.productTitle) {
          movementsToLog.push({
            shop_id: shopId,
            location_id: locationUuid,
            variant_id: resolvedVariantId,
            product_title: item.productTitle,
            variant_title: item.variantTitle || null,
            quantity: item.quantity,
          });
        }

        results.push({
          variantId: item.variantId,
          label,
          success: true,
        });

      } catch (itemError) {
        console.error('[POS adjust] Error processing item:', itemError);
        results.push({
          variantId: item.variantId,
          label,
          success: false,
          retryable: false,
          error: 'Erreur de traitement — vérifier le stock avant de revalider',
        });
      }
    }

    // Log movements — aggregate by variant + day (daily totals only)
    if (movementsToLog.length > 0) {
      // Group by variant_id to aggregate quantities
      const aggregated = new Map<string, typeof movementsToLog[0]>();
      for (const m of movementsToLog) {
        const existing = aggregated.get(m.variant_id);
        if (existing) {
          existing.quantity += m.quantity;
        } else {
          aggregated.set(m.variant_id, { ...m });
        }
      }

      // Upsert: if a row already exists for this variant + today, add to it
      for (const movement of aggregated.values()) {
        let existingQuery = supabase
          .from('stock_movements')
          .select('id, quantity')
          .eq('shop_id', movement.shop_id)
          .eq('variant_id', movement.variant_id)
          .eq('moved_on', today);

        if (movement.location_id) {
          existingQuery = existingQuery.eq('location_id', movement.location_id);
        } else {
          existingQuery = existingQuery.is('location_id', null);
        }

        const { data: existing } = await existingQuery.maybeSingle();

        if (existing) {
          const { error: updateErr } = await supabase
            .from('stock_movements')
            .update({ quantity: existing.quantity + movement.quantity })
            .eq('id', existing.id);
          if (updateErr) {
            console.error('stock_movements update failed:', updateErr, { movement });
          }
        } else {
          const { error: insertErr } = await supabase
            .from('stock_movements')
            .insert({ ...movement, moved_on: today });
          if (insertErr) {
            console.error('stock_movements insert failed:', insertErr, { movement });
          }
        }
      }

    }

    const failed = results.filter(r => !r.success);
    const allSuccess = failed.length === 0;
    const successCount = results.length - failed.length;

    return NextResponse.json({
      success: allSuccess,
      message: `${successCount}/${items.length} ajustements effectués`,
      results,
      // Remonté à l'UI pour l'alerte : combien d'items n'ont PAS atteint Shopify.
      shopifyFailedCount: failed.filter(r => r.shopifyFailed).length,
    });

  } catch (error) {
    console.error('Error in POST /api/pos/stock/adjust:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
