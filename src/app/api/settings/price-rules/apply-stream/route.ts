import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MUTATION_BATCH_SIZE = 10;

function buildBatchCostMutation(items: { inventoryItemId: string; cost: string }[]): string {
  const mutations = items.map((item, idx) =>
    `u${idx}: inventoryItemUpdate(id: "${item.inventoryItemId}", input: {cost: "${item.cost}"}) {
      inventoryItem { id }
      userErrors { field message }
    }`
  ).join('\n  ');
  return `mutation {\n  ${mutations}\n}`;
}

const GET_VARIANTS_BY_SKU_QUERY = `
  query getVariantsBySku($query: String!, $cursor: String) {
    productVariants(first: 100, query: $query, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        sku
        title
        selectedOptions {
          name
          value
        }
        product {
          productType
        }
        inventoryItem {
          id
        }
        metafields(first: 20) {
          nodes {
            namespace
            key
            value
          }
        }
      }
    }
  }
`;

// Raw fetch to Shopify GraphQL API — bypasses @shopify/admin-api-client which
// can throw non-standard errors that silently kill SSE streams.
async function shopifyGraphQL(
  shopDomain: string,
  token: string,
  query: string,
  variables: any,
  send: (message: string, type?: string) => void,
  maxRetries = 6
): Promise<any> {
  const url = `https://${shopDomain}/admin/api/2024-10/graphql.json`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response | undefined;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
        body: JSON.stringify({ query, variables }),
      });

      // Hard rate-limit (HTTP 429)
      if (res.status === 429) {
        const retryAfter = parseFloat(res.headers.get('Retry-After') || '2');
        const waitMs = Math.max(retryAfter * 1000, 2000) * (attempt + 1);
        send(`  ⏳ HTTP 429 — pause ${(waitMs / 1000).toFixed(1)}s (tentative ${attempt + 1}/${maxRetries})`, 'info');
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      const json = await res.json();

      // Check for THROTTLED GraphQL error
      if (json.errors?.some((e: any) => e.extensions?.code === 'THROTTLED')) {
        const waitMs = 2000 * (attempt + 1);
        send(`  ⏳ Throttle GraphQL — pause ${(waitMs / 1000).toFixed(0)}s (tentative ${attempt + 1}/${maxRetries})`, 'info');
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      // Proactive throttle management via cost extensions
      const throttle = json.extensions?.cost?.throttleStatus;
      if (throttle) {
        const remaining = throttle.currentlyAvailable;
        const restoreRate = throttle.restoreRate;
        if (remaining < 200) {
          const waitMs = Math.ceil(((200 - remaining) / restoreRate) * 1000);
          if (waitMs > 500) {
            send(`  ⏳ Budget API bas (${remaining} pts), pause ${(waitMs / 1000).toFixed(1)}s...`, 'info');
          }
          await new Promise(r => setTimeout(r, waitMs));
        }
      }

      return json;
    } catch (err: any) {
      const errMsg = err?.message || String(err);

      // Network / timeout errors — always retry
      if (attempt < maxRetries) {
        const waitMs = 1000 * (attempt + 1);
        send(`  ⚠️ Erreur réseau (${errMsg.slice(0, 80)}), retry dans ${(waitMs / 1000).toFixed(0)}s...`, 'info');
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get('shopId');
  const ruleId = searchParams.get('ruleId');
  const cursorParam = searchParams.get('cursor');
  const offsetParam = parseInt(searchParams.get('offset') || '0', 10);

  if (!shopId || !ruleId) {
    return new Response('Missing shopId or ruleId', { status: 400 });
  }

  const encoder = new TextEncoder();
  let streamClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (message: string, type: string = 'info') => {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ message, type, timestamp: new Date().toISOString() })}\n\n`));
        } catch {
          streamClosed = true;
        }
      };

      const sendDone = (extra: Record<string, unknown> = {}) => {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            message: 'DONE',
            type: 'success',
            timestamp: new Date().toISOString(),
            ...extra,
          })}\n\n`));
        } catch {
          streamClosed = true;
        }
      };

      // Heartbeat to keep the connection alive (every 10s)
      const heartbeat = setInterval(() => {
        if (streamClosed) { clearInterval(heartbeat); return; }
        send('', 'keepalive');
      }, 10000);

      const isFirstChunk = !cursorParam;

      try {
        // Fetch shop + rule (every chunk needs them for cost calculation)
        const { data: shop, error: shopError } = await supabase
          .from('shops')
          .select('*')
          .eq('id', shopId)
          .single();

        if (shopError || !shop) {
          send('❌ Boutique non trouvée', 'error');
          sendDone();
          return;
        }

        const { data: rule, error: ruleError } = await supabase
          .from('price_rules')
          .select(`*, modifiers:price_rule_modifiers(*), option_modifiers:price_rule_option_modifiers(*)`)
          .eq('id', ruleId)
          .single();

        if (ruleError || !rule || !rule.sku) {
          send('❌ Règle non trouvée ou SKU manquant', 'error');
          sendDone();
          return;
        }

        // Show setup info only on first chunk
        if (isFirstChunk) {
          send('🚀 Démarrage de l\'application des règles...', 'info');
          send(`✓ Boutique: ${shop.name || shop.shopify_url}`, 'success');
          send(`✓ Règle: ${rule.sku} (base: ${rule.base_price}€)`, 'success');
          if (rule.modifiers?.length > 0) {
            send(`  └─ ${rule.modifiers.length} modificateur(s) métachamp`, 'info');
          }
          if (rule.option_modifiers?.length > 0) {
            send(`  └─ ${rule.option_modifiers.length} modificateur(s) d'option`, 'info');
          }
        }

        const shopDomain = shop.shopify_url;
        const shopToken = shop.shopify_token;

        // Fetch ONE page of variants (100 max)
        const pageNum = Math.floor(offsetParam / 100) + 1;
        send(`📦 Page ${pageNum}: récupération des variantes...`, 'info');

        const variantsResult = await shopifyGraphQL(
          shopDomain, shopToken,
          GET_VARIANTS_BY_SKU_QUERY,
          { query: `sku:${rule.sku}*`, cursor: cursorParam || null },
          send
        );

        const pageData = variantsResult.data?.productVariants;
        const pageVariants = pageData?.nodes || [];
        const hasNextPage = pageData?.pageInfo?.hasNextPage || false;
        const nextCursor = pageData?.pageInfo?.endCursor || null;

        if (pageVariants.length === 0) {
          send('⚠️ Aucune variante sur cette page', 'info');
          sendDone();
          return;
        }

        send(`  └─ ${pageVariants.length} variantes récupérées`, 'info');

        // Calculate costs (local, no API)
        let updatedCount = 0;
        let errorCount = 0;

        type VariantUpdate = { variant: any; cost: number; costParts: string[]; label: string; globalIndex: number };
        const variantUpdates: VariantUpdate[] = [];

        for (let i = 0; i < pageVariants.length; i++) {
          const variant = pageVariants[i];
          const variantLabel = `${variant.sku || 'no-sku'} - ${variant.title || 'no-title'}`;
          const globalIndex = offsetParam + i;

          if (!variant.inventoryItem?.id) {
            send(`  ⚠️ [${globalIndex + 1}] ${variantLabel}: pas d'inventoryItem, ignoré`, 'warning');
            errorCount++;
            continue;
          }

          let cost = rule.base_price;
          const metafields = variant.metafields?.nodes || [];
          const selectedOptions = variant.selectedOptions || [];
          const costParts: string[] = [`${rule.base_price}€`];

          for (const modifier of rule.modifiers || []) {
            const match = metafields.find(
              (mf: any) =>
                mf.namespace === modifier.metafield_namespace &&
                mf.key === modifier.metafield_key &&
                mf.value === modifier.metafield_value
            );
            if (match) {
              cost += modifier.modifier_amount;
              const sign = modifier.modifier_amount >= 0 ? '+' : '';
              costParts.push(`${sign}${modifier.modifier_amount}€ (${modifier.metafield_value})`);
            }
          }

          for (const optMod of rule.option_modifiers || []) {
            const match = selectedOptions.find(
              (opt: any) =>
                opt.name.toLowerCase() === optMod.option_name.toLowerCase() &&
                opt.value.toLowerCase() === optMod.option_value.toLowerCase()
            );
            if (match) {
              cost += optMod.modifier_amount;
              const sign = optMod.modifier_amount >= 0 ? '+' : '';
              costParts.push(`${sign}${optMod.modifier_amount}€ (${optMod.option_value})`);
            }
          }

          variantUpdates.push({ variant, cost, costParts, label: variantLabel, globalIndex });
        }

        // Apply mutations in batches
        send(`🔄 Application (${variantUpdates.length} variantes)...`, 'info');

        for (let b = 0; b < variantUpdates.length; b += MUTATION_BATCH_SIZE) {
          if (streamClosed) break;

          const batch = variantUpdates.slice(b, b + MUTATION_BATCH_SIZE);

          try {
            const batchQuery = buildBatchCostMutation(
              batch.map(item => ({
                inventoryItemId: item.variant.inventoryItem.id,
                cost: item.cost.toFixed(2),
              }))
            );

            const result = await shopifyGraphQL(shopDomain, shopToken, batchQuery, {}, send);

            for (let idx = 0; idx < batch.length; idx++) {
              const item = batch[idx];
              const updateResult = result.data?.[`u${idx}`];

              if (updateResult?.userErrors?.length > 0) {
                const err = updateResult.userErrors[0].message;
                send(`  ❌ [${item.globalIndex + 1}] ${item.label}: ${err}`, 'error');
                errorCount++;
              } else {
                const calcStr = item.costParts.length > 1 ? ` (${item.costParts.join(' ')})` : '';
                send(`  ✓ [${item.globalIndex + 1}] ${item.label} → ${item.cost.toFixed(2)}€${calcStr}`, 'progress');
                updatedCount++;
              }
            }
          } catch (err: any) {
            console.error(`[apply-stream] CRASH at batch:`, err);
            for (const item of batch) {
              send(`  ❌ [${item.globalIndex + 1}] ${item.label}: ${err?.message || String(err)}`, 'error');
              errorCount++;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

        // If last chunk, update last_applied_at
        if (!hasNextPage) {
          await supabase
            .from('price_rules')
            .update({ last_applied_at: new Date().toISOString() })
            .eq('id', ruleId);
        }

        sendDone({
          nextCursor: hasNextPage ? nextCursor : null,
          offset: offsetParam + pageVariants.length,
          updatedCount,
          errorCount,
        });

      } catch (error: any) {
        send(`❌ Erreur fatale: ${error?.message || error}`, 'error');
        sendDone();
      } finally {
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
