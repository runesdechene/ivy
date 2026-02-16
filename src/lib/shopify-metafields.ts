import { SupabaseClient } from '@supabase/supabase-js';

const UPSERT_BATCH_SIZE = 500;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 100;
const SHOPIFY_MAX_QUERY_COST = 950; // Marge de sécurité sous la limite de 1000

type LogFn = (message: string, type?: string) => void;

interface MetafieldConfig {
  namespace: string;
  key: string;
}

interface MetafieldRow {
  variant_id: string;
  namespace: string;
  key: string;
  value: string;
  type: string;
  synced_at: string;
}

function buildMetafieldsQuery(): string {
  return `
    query GetVariantMetafields($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          metafields(first: 50) {
            edges {
              node {
                namespace
                key
                value
                type
              }
            }
          }
        }
      }
    }
  `;
}

/**
 * Synchronise les métachamps des variantes depuis Shopify GraphQL vers la table variant_metafields.
 * Ne fait aucun appel API si le shop n'a aucun metafield_config actif.
 */
export async function syncVariantMetafields(
  supabase: SupabaseClient,
  shopId: string,
  shopDomain: string,
  shopToken: string,
  variantIdMap: Record<string, string>, // shopify_id -> supabase UUID
  log?: LogFn
): Promise<number> {
  const send = log ?? (() => {});

  // 1. Charger les configs actives
  const { data: configs } = await supabase
    .from('metafield_config')
    .select('namespace, key')
    .eq('shop_id', shopId)
    .eq('is_active', true);

  if (!configs || configs.length === 0) {
    return 0;
  }

  // Map pour filtrage rapide (case-insensitive)
  const configMap = new Map<string, MetafieldConfig>();
  for (const c of configs) {
    configMap.set(`${c.namespace}.${c.key}`.toLowerCase(), c);
  }

  const shopifyIds = Object.keys(variantIdMap);
  if (shopifyIds.length === 0) return 0;

  // metafields(first: 50) pour couvrir tous les métachamps existants sur la variante
  // Coût GraphQL par nœud : 1 (nœud) + 50 (métachamps) = 51
  // Batch = floor(950 / 51) = 18 variantes par requête
  const costPerNode = 51;
  const batchSize = Math.max(10, Math.floor(SHOPIFY_MAX_QUERY_COST / costPerNode));
  const query = buildMetafieldsQuery();

  send('', 'info');
  send(`🏷️ Synchronisation des métachamps (${configs.length} config(s), batch de ${batchSize})...`, 'info');

  // 2. Batch GraphQL
  const allRows: MetafieldRow[] = [];
  const totalBatches = Math.ceil(shopifyIds.length / batchSize);
  const now = new Date().toISOString();
  let nullNodesCount = 0;

  let lastActualCost = 0;
  let lastRestoreRate = 50; // défaut Shopify

  for (let i = 0; i < shopifyIds.length; i += batchSize) {
    const batchNum = Math.floor(i / batchSize) + 1;
    const batch = shopifyIds.slice(i, i + batchSize);
    const gids = batch.map(id => `gid://shopify/ProductVariant/${id}`);

    if (totalBatches > 5 && batchNum % 10 === 1) {
      send(`  └─ Batch ${batchNum}-${Math.min(batchNum + 9, totalBatches)}/${totalBatches}...`, 'progress');
    } else if (totalBatches > 1 && totalBatches <= 5) {
      send(`  └─ Batch ${batchNum}/${totalBatches} (${batch.length} variantes)...`, 'progress');
    }

    let retries = 0;
    let success = false;

    while (!success && retries <= MAX_RETRIES) {
      if (retries > 0) {
        // Backoff exponentiel sur retry
        const backoff = BASE_DELAY_MS * Math.pow(4, retries);
        await new Promise(resolve => setTimeout(resolve, backoff));
      }

      const response = await fetch(
        `https://${shopDomain}/admin/api/2024-01/graphql.json`,
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': shopToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query,
            variables: { ids: gids },
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();

        // Rate limiting dynamique basé sur le budget disponible Shopify
        if (data.extensions?.cost) {
          const cost = data.extensions.cost;
          lastActualCost = cost.actualQueryCost || lastActualCost;
          lastRestoreRate = cost.throttleStatus?.restoreRate || lastRestoreRate;
          const available = cost.throttleStatus?.currentlyAvailable ?? 1000;

          if (batchNum === 1) {
            send(`    📊 Coût réel: ${lastActualCost}, budget: ${available}/${cost.throttleStatus?.maximumAvailable}, recharge: ${lastRestoreRate}/s`, 'info');
          }

          // Si le budget restant est insuffisant pour le prochain batch, attendre la recharge
          if (available < lastActualCost * 1.2 && i + batchSize < shopifyIds.length) {
            const deficit = lastActualCost * 1.2 - available;
            const waitMs = Math.ceil((deficit / lastRestoreRate) * 1000) + 100;
            if (waitMs > 200) {
              await new Promise(resolve => setTimeout(resolve, waitMs));
            }
          }
        }

        if (data.errors) {
          const throttled = data.errors.some((e: { message?: string }) =>
            e.message?.includes('Throttled')
          );
          const costExceeded = data.errors.some((e: { message?: string }) =>
            e.message?.includes('cost') || e.message?.includes('exceeded')
          );

          if ((throttled || costExceeded) && retries < MAX_RETRIES) {
            retries++;
            // Attendre plus longtemps pour laisser le bucket se remplir
            const throttleWait = Math.ceil((lastActualCost * 2) / lastRestoreRate * 1000);
            send(`    ⏳ ${costExceeded ? 'Coût dépassé' : 'Throttled'}, attente ${(throttleWait / 1000).toFixed(1)}s (retry ${retries}/${MAX_RETRIES})...`, 'warning');
            await new Promise(resolve => setTimeout(resolve, throttleWait));
            continue;
          }
          send(`    ⚠️ Erreurs GraphQL: ${data.errors[0]?.message}`, 'warning');
        }

        const nodes = data.data?.nodes || [];
        for (const node of nodes) {
          if (!node?.id) {
            nullNodesCount++;
            continue;
          }
          const shopifyId = node.id.replace('gid://shopify/ProductVariant/', '');
          const variantUuid = variantIdMap[shopifyId];
          if (!variantUuid) continue;

          for (const edge of node.metafields?.edges || []) {
            const mf = edge.node;
            if (!mf?.value) continue;

            const fullKey = `${mf.namespace}.${mf.key}`.toLowerCase();
            if (!configMap.has(fullKey)) continue;

            allRows.push({
              variant_id: variantUuid,
              namespace: mf.namespace,
              key: mf.key,
              value: mf.value,
              type: mf.type || 'single_line_text_field',
              synced_at: now,
            });
          }
        }
        success = true;
      } else if (response.status === 429) {
        retries++;
        const throttleWait = Math.ceil((lastActualCost * 2) / lastRestoreRate * 1000);
        if (retries <= MAX_RETRIES) {
          send(`    ⏳ HTTP 429, attente ${(throttleWait / 1000).toFixed(1)}s (retry ${retries}/${MAX_RETRIES})...`, 'warning');
          await new Promise(resolve => setTimeout(resolve, throttleWait));
        } else {
          send(`    ❌ Batch ${batchNum}: rate limit après ${MAX_RETRIES} retries`, 'error');
        }
      } else {
        send(`    ❌ Erreur GraphQL batch ${batchNum}: ${response.status}`, 'error');
        break;
      }
    }
  }

  if (nullNodesCount > 0) {
    send(`    ℹ️ ${nullNodesCount} variante(s) locale(s) ignorée(s) (absentes de Shopify)`, 'info');
  }

  // 3. Upsert
  if (allRows.length > 0) {
    for (let i = 0; i < allRows.length; i += UPSERT_BATCH_SIZE) {
      const batch = allRows.slice(i, i + UPSERT_BATCH_SIZE);
      const { error } = await supabase
        .from('variant_metafields')
        .upsert(batch, { onConflict: 'variant_id,namespace,key' });

      if (error) {
        send(`    ❌ Erreur upsert métachamps: ${error.message}`, 'error');
      }
    }
  }

  send(`✓ ${allRows.length} métachamp(s) synchronisé(s)`, 'success');
  return allRows.length;
}

/**
 * Supprime les variantes locales dont les options (option1/option2/option3)
 * correspondent à une variante Shopify active du même produit.
 * Utile quand une variante est recréée sur Shopify avec un nouvel ID.
 */
export async function deduplicateLocalVariants(
  supabase: SupabaseClient,
  productIds: string[],
  log?: LogFn
): Promise<number> {
  if (productIds.length === 0) return 0;

  // Fetch toutes les variantes des produits concernés (pagination .range() car Supabase plafonne à 1000 rows)
  const variants: { id: string; product_id: string; option1: string | null; option2: string | null; option3: string | null; shopify_active: boolean | null }[] = [];
  for (let i = 0; i < productIds.length; i += 50) {
    const pBatch = productIds.slice(i, i + 50);
    let from = 0;
    while (true) {
      const { data } = await supabase
        .from('product_variants')
        .select('id, product_id, option1, option2, option3, shopify_active')
        .in('product_id', pBatch)
        .range(from, from + 999);
      if (data && data.length > 0) {
        variants.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      } else {
        break;
      }
    }
  }

  if (variants.length === 0) return 0;

  // Grouper par produit
  const byProduct: Record<string, typeof variants> = {};
  for (const v of variants) {
    if (!byProduct[v.product_id]) byProduct[v.product_id] = [];
    byProduct[v.product_id].push(v);
  }

  const toDelete: string[] = [];

  for (const productVariants of Object.values(byProduct)) {
    // Fingerprints des variantes Shopify actives
    const activeFingerprints = new Set<string>();
    for (const v of productVariants) {
      if (v.shopify_active !== false) {
        activeFingerprints.add(`${v.option1 ?? ''}|${v.option2 ?? ''}|${v.option3 ?? ''}`);
      }
    }

    // Trouver les locales qui matchent
    for (const v of productVariants) {
      if (v.shopify_active === false) {
        const fp = `${v.option1 ?? ''}|${v.option2 ?? ''}|${v.option3 ?? ''}`;
        if (activeFingerprints.has(fp)) {
          toDelete.push(v.id);
        }
      }
    }
  }

  if (toDelete.length === 0) return 0;

  // Supprimer par batch (cascade nettoie inventory_levels + variant_metafields)
  for (let i = 0; i < toDelete.length; i += UPSERT_BATCH_SIZE) {
    const batch = toDelete.slice(i, i + UPSERT_BATCH_SIZE);
    await supabase
      .from('product_variants')
      .delete()
      .in('id', batch);
  }

  log?.(`🧹 ${toDelete.length} variante(s) locale(s) dupliquée(s) supprimée(s)`, 'info');
  return toDelete.length;
}
