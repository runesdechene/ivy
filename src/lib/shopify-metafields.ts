import { SupabaseClient } from '@supabase/supabase-js';

const UPSERT_BATCH_SIZE = 500;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 100;
const SHOPIFY_MAX_QUERY_COST = 950; // Marge de sécurité sous la limite de 1000
const FETCH_TIMEOUT_MS = 30_000; // 30 secondes max par requête GraphQL

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

/**
 * Construit une requête GraphQL ciblée : un champ `metafield(namespace, key)` par config active.
 * Coût estimé par nœud : 1 (nœud) + N (un par metafield singulier) au lieu de 1 + 50.
 */
function buildTargetedMetafieldsQuery(configs: MetafieldConfig[]): string {
  const metafieldFields = configs.map((c, i) =>
    `mf${i}: metafield(namespace: "${c.namespace}", key: "${c.key}") { namespace key value type }`
  ).join('\n          ');

  return `
    query GetVariantMetafields($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          ${metafieldFields}
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

  const shopifyIds = Object.keys(variantIdMap);
  if (shopifyIds.length === 0) return 0;

  // Requête ciblée : 1 champ metafield() par config → coût estimé = 1 + N configs
  // Avec 3 configs : 4/nœud au lieu de 51 → ~237 variantes/batch au lieu de 18
  const costPerNode = 1 + configs.length;
  const batchSize = Math.min(250, Math.max(10, Math.floor(SHOPIFY_MAX_QUERY_COST / costPerNode)));
  const query = buildTargetedMetafieldsQuery(configs);

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

    // Toujours envoyer un message par batch pour garder le stream SSE actif
    if (totalBatches <= 5) {
      send(`  └─ Batch ${batchNum}/${totalBatches} (${batch.length} variantes)...`, 'progress');
    } else {
      send(`  └─ Batch ${batchNum}/${totalBatches}...`, 'progress');
    }

    let retries = 0;
    let success = false;

    while (!success && retries <= MAX_RETRIES) {
      if (retries > 0) {
        // Backoff exponentiel sur retry
        const backoff = BASE_DELAY_MS * Math.pow(4, retries);
        await new Promise(resolve => setTimeout(resolve, backoff));
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

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
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

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

            // Lire chaque champ mfN (un par config active)
            for (let ci = 0; ci < configs.length; ci++) {
              const mf = node[`mf${ci}`];
              if (!mf?.value) continue;

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
      } catch (fetchError: unknown) {
        const errMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
        const isTimeout = errMsg.includes('abort');
        retries++;
        if (retries <= MAX_RETRIES) {
          send(`    ⚠️ Batch ${batchNum}: ${isTimeout ? 'timeout' : errMsg}, retry ${retries}/${MAX_RETRIES}...`, 'warning');
        } else {
          send(`    ❌ Batch ${batchNum}: échec après ${MAX_RETRIES} retries (${errMsg})`, 'error');
        }
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

interface MetafieldConfigWithDisplay {
  namespace: string;
  key: string;
  display_name?: string | null;
}

export interface FetchMetafieldsByDisplayNameResult {
  /** shopify_id -> { display_name -> value } */
  byShopifyId: Record<string, Record<string, string>>;
  /** Variantes effectivement parcourues par Shopify (succès du batch). Sert à savoir
   *  ce qu'il est sûr d'écraser en DB ; les variantes absentes ne doivent pas voir
   *  leurs métachamps écrasés à `{}`. */
  fetchedShopifyIds: Set<string>;
  totalBatches: number;
  failedBatches: number;
}

/**
 * Récupère les métachamps des variantes depuis Shopify GraphQL et les retourne
 * indexés par `display_name` (format attendu par `supplier_order_items.metafields`
 * et `variant_metafields` côté affichage).
 *
 * Différences avec `syncVariantMetafields` :
 * - Ne touche pas la table `variant_metafields` (lecture seule, pour usage transactionnel).
 * - Retourne le résultat avec un `Set` des shopifyIds réellement récupérés afin que
 *   l'appelant puisse éviter d'écraser des métachamps existants en cas d'échec partiel.
 *
 * Caractéristiques :
 * - Requête ciblée (1 + N points par node) au lieu de `metafields(first: 50)` (~51).
 * - Batching dynamique sous 950 points (limite Shopify 1000).
 * - Retries sur Throttled / cost exceeded / 429.
 */
export async function fetchVariantMetafieldsByDisplayName(
  supabase: SupabaseClient,
  shopId: string,
  variantShopifyIds: string[],
  configs: MetafieldConfigWithDisplay[],
  log?: LogFn
): Promise<FetchMetafieldsByDisplayNameResult> {
  const send = log ?? (() => {});
  const empty: FetchMetafieldsByDisplayNameResult = {
    byShopifyId: {},
    fetchedShopifyIds: new Set(),
    totalBatches: 0,
    failedBatches: 0,
  };

  if (variantShopifyIds.length === 0 || configs.length === 0) return empty;

  const { data: shop } = await supabase
    .from('shops')
    .select('shopify_url, shopify_token')
    .eq('id', shopId)
    .single();
  if (!shop) return empty;

  const configuredKeysMap = new Map<string, MetafieldConfigWithDisplay>();
  for (const c of configs) {
    configuredKeysMap.set(`${c.namespace}.${c.key}`.toLowerCase(), c);
  }

  // Requête ciblée : un champ `metafield(namespace, key)` par config active.
  // Coût ≈ 1 (node) + N (un par metafield singulier).
  const costPerNode = 1 + configs.length;
  const batchSize = Math.min(250, Math.max(10, Math.floor(SHOPIFY_MAX_QUERY_COST / costPerNode)));
  const query = buildTargetedMetafieldsQuery(configs);

  const result: Record<string, Record<string, string>> = {};
  const fetched = new Set<string>();
  const totalBatches = Math.ceil(variantShopifyIds.length / batchSize);
  let failedBatches = 0;
  let lastActualCost = 0;
  let lastRestoreRate = 50;

  for (let i = 0; i < variantShopifyIds.length; i += batchSize) {
    const batchNum = Math.floor(i / batchSize) + 1;
    const batch = variantShopifyIds.slice(i, i + batchSize);
    const gids = batch.map(id => `gid://shopify/ProductVariant/${id}`);

    let retries = 0;
    let success = false;

    while (!success && retries <= MAX_RETRIES) {
      if (retries > 0) {
        const backoff = BASE_DELAY_MS * Math.pow(4, retries);
        await new Promise(resolve => setTimeout(resolve, backoff));
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(
          `https://${shop.shopify_url}/admin/api/2024-01/graphql.json`,
          {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': shop.shopify_token,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query, variables: { ids: gids } }),
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);

        if (response.status === 429) {
          retries++;
          const throttleWait = Math.ceil((lastActualCost * 2) / lastRestoreRate * 1000);
          if (retries <= MAX_RETRIES) {
            send(`    ⏳ HTTP 429 batch ${batchNum}, attente ${(throttleWait / 1000).toFixed(1)}s (retry ${retries}/${MAX_RETRIES})...`, 'warning');
            await new Promise(resolve => setTimeout(resolve, throttleWait));
            continue;
          }
          send(`    ❌ Batch ${batchNum}: rate limit après ${MAX_RETRIES} retries`, 'error');
          break;
        }
        if (!response.ok) {
          send(`    ❌ Batch ${batchNum}: HTTP ${response.status}`, 'error');
          break;
        }

        const data = await response.json();

        if (data.extensions?.cost) {
          const cost = data.extensions.cost;
          lastActualCost = cost.actualQueryCost || lastActualCost;
          lastRestoreRate = cost.throttleStatus?.restoreRate || lastRestoreRate;
          const available = cost.throttleStatus?.currentlyAvailable ?? 1000;
          if (available < lastActualCost * 1.2 && i + batchSize < variantShopifyIds.length) {
            const deficit = lastActualCost * 1.2 - available;
            const waitMs = Math.ceil((deficit / lastRestoreRate) * 1000) + 100;
            if (waitMs > 200) {
              await new Promise(resolve => setTimeout(resolve, waitMs));
            }
          }
        }

        if (data.errors) {
          const throttled = data.errors.some((e: { message?: string }) => e.message?.includes('Throttled'));
          const costExceeded = data.errors.some((e: { message?: string }) =>
            e.message?.includes('cost') || e.message?.includes('exceeded')
          );
          if ((throttled || costExceeded) && retries < MAX_RETRIES) {
            retries++;
            const throttleWait = Math.ceil((lastActualCost * 2) / lastRestoreRate * 1000);
            send(`    ⏳ ${costExceeded ? 'Coût dépassé' : 'Throttled'} batch ${batchNum}, attente ${(throttleWait / 1000).toFixed(1)}s (retry ${retries}/${MAX_RETRIES})...`, 'warning');
            await new Promise(resolve => setTimeout(resolve, throttleWait));
            continue;
          }
          send(`    ⚠️ Erreurs GraphQL batch ${batchNum}: ${data.errors[0]?.message}`, 'warning');
        }

        const nodes = data.data?.nodes || [];
        for (const node of nodes) {
          if (!node?.id) continue;
          const shopifyId = String(node.id).replace('gid://shopify/ProductVariant/', '');
          fetched.add(shopifyId);
          result[shopifyId] = {};
          for (let ci = 0; ci < configs.length; ci++) {
            const mf = node[`mf${ci}`];
            if (!mf?.value) continue;
            const fullKeyLower = `${mf.namespace}.${mf.key}`.toLowerCase();
            const cfg = configuredKeysMap.get(fullKeyLower);
            if (cfg) {
              const displayName = cfg.display_name || `${mf.namespace}.${mf.key}`;
              result[shopifyId][displayName] = mf.value;
            }
          }
        }
        success = true;
      } catch (fetchError: unknown) {
        const errMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
        const isTimeout = errMsg.includes('abort');
        retries++;
        if (retries <= MAX_RETRIES) {
          send(`    ⚠️ Batch ${batchNum}: ${isTimeout ? 'timeout' : errMsg}, retry ${retries}/${MAX_RETRIES}...`, 'warning');
        } else {
          send(`    ❌ Batch ${batchNum}: échec après ${MAX_RETRIES} retries (${errMsg})`, 'error');
        }
      }
    }

    if (!success) failedBatches++;
  }

  return {
    byShopifyId: result,
    fetchedShopifyIds: fetched,
    totalBatches,
    failedBatches,
  };
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
        .order('id')
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
