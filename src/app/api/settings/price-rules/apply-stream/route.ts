import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MUTATION_BATCH_SIZE = 50;

function buildBatchCostMutation(items: { inventoryItemId: string; cost: string }[]): string {
  const mutations = items.map((item, idx) =>
    `u${idx}: inventoryItemUpdate(id: "${item.inventoryItemId}", input: {cost: "${item.cost}"}) {
      inventoryItem { id }
      userErrors { field message }
    }`
  ).join('\n  ');
  return `mutation {\n  ${mutations}\n}`;
}

const GET_VARIANTS_BY_PRODUCT_TYPE_QUERY = `
  query getVariantsByProductType($query: String!, $cursor: String) {
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

      // Heartbeat to keep the connection alive (every 10s)
      // Uses a real data: message (not SSE comment) so it passes through Netlify's proxy
      const heartbeat = setInterval(() => {
        if (streamClosed) { clearInterval(heartbeat); return; }
        send('', 'keepalive');
      }, 10000);

      try {
        send('🚀 Démarrage de l\'application des règles...', 'info');

        // Récupérer la boutique
        const { data: shop, error: shopError } = await supabase
          .from('shops')
          .select('*')
          .eq('id', shopId)
          .single();

        if (shopError || !shop) {
          send('❌ Boutique non trouvée', 'error');
          return;
        }

        send(`✓ Boutique: ${shop.name || shop.shopify_url}`, 'success');

        // Récupérer la règle
        const { data: rule, error: ruleError } = await supabase
          .from('price_rules')
          .select(`*, modifiers:price_rule_modifiers(*), option_modifiers:price_rule_option_modifiers(*)`)
          .eq('id', ruleId)
          .single();

        if (ruleError || !rule) {
          send('❌ Règle non trouvée', 'error');
          return;
        }

        if (!rule.product_type) {
          send('❌ La règle doit avoir un type de produit défini', 'error');
          return;
        }

        send(`✓ Règle: ${rule.product_type} (base: ${rule.base_price}€)`, 'success');
        
        if (rule.modifiers?.length > 0) {
          send(`  └─ ${rule.modifiers.length} modificateur(s) métachamp`, 'info');
        }
        
        if (rule.option_modifiers?.length > 0) {
          send(`  └─ ${rule.option_modifiers.length} modificateur(s) d'option`, 'info');
        }

        const shopDomain = shop.shopify_url;
        const shopToken = shop.shopify_token;

        // Récupérer toutes les variantes par type de produit
        send(`📦 Récupération des variantes (${rule.product_type})...`, 'info');
        
        let allVariants: any[] = [];
        let cursor: string | null = null;
        let hasNextPage = true;
        let pageNum = 0;

        while (hasNextPage) {
          pageNum++;
          const variantsResult = await shopifyGraphQL(
            shopDomain, shopToken,
            GET_VARIANTS_BY_PRODUCT_TYPE_QUERY,
            { query: `product_type:"${rule.product_type}"`, cursor },
            send
          );

          const pageData = variantsResult.data?.productVariants;
          const pageVariants = pageData?.nodes || [];
          allVariants = [...allVariants, ...pageVariants];
          
          hasNextPage = pageData?.pageInfo?.hasNextPage || false;
          cursor = pageData?.pageInfo?.endCursor || null;
          
          send(`  └─ Page ${pageNum}: ${pageVariants.length} variantes (total: ${allVariants.length})`, 'info');
        }

        if (allVariants.length === 0) {
          send(`⚠️ Aucune variante trouvée pour le type "${rule.product_type}"`, 'error');
          return;
        }

        send(`✓ ${allVariants.length} variante(s) récupérée(s)`, 'success');
        send('', 'info');
        send('📊 Calcul des coûts...', 'info');

        let updatedCount = 0;
        let errorCount = 0;

        // Phase 1: Pré-calculer tous les coûts (local, pas d'API)
        type VariantUpdate = { variant: any; cost: number; costParts: string[]; label: string; originalIndex: number };
        const variantUpdates: VariantUpdate[] = [];

        for (let i = 0; i < allVariants.length; i++) {
          const variant = allVariants[i];
          const variantLabel = `${variant.sku || 'no-sku'} - ${variant.title || 'no-title'}`;

          if (!variant.inventoryItem?.id) {
            send(`  ⚠️ [${i + 1}/${allVariants.length}] ${variantLabel}: pas d'inventoryItem, ignoré`, 'warning');
            console.log(`[apply-stream] Variant ${i} has no inventoryItem:`, JSON.stringify(variant).slice(0, 300));
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

          variantUpdates.push({ variant, cost, costParts, label: variantLabel, originalIndex: i });
        }

        send(`✓ ${variantUpdates.length} variante(s) à mettre à jour`, 'success');
        send('', 'info');
        send('🔄 Application par batch de ' + MUTATION_BATCH_SIZE + '...', 'info');

        // Phase 2: Mutations par batch (10 mutations par requête GraphQL au lieu de 1)
        const totalBatches = Math.ceil(variantUpdates.length / MUTATION_BATCH_SIZE);

        for (let b = 0; b < variantUpdates.length; b += MUTATION_BATCH_SIZE) {
          if (streamClosed) {
            console.log(`Stream closed by client at batch ${Math.floor(b / MUTATION_BATCH_SIZE) + 1}`);
            break;
          }

          const batch = variantUpdates.slice(b, b + MUTATION_BATCH_SIZE);
          const batchNum = Math.floor(b / MUTATION_BATCH_SIZE) + 1;

          try {
            const batchQuery = buildBatchCostMutation(
              batch.map(item => ({
                inventoryItemId: item.variant.inventoryItem.id,
                cost: item.cost.toFixed(2),
              }))
            );

            console.log(`[apply-stream] Batch ${batchNum}/${totalBatches} (${batch.length} variants)`);
            const result = await shopifyGraphQL(shopDomain, shopToken, batchQuery, {}, send);

            for (let idx = 0; idx < batch.length; idx++) {
              const item = batch[idx];
              const updateResult = result.data?.[`u${idx}`];

              if (updateResult?.userErrors?.length > 0) {
                const err = updateResult.userErrors[0].message;
                send(`  ❌ [${item.originalIndex + 1}/${allVariants.length}] ${item.label}: ${err}`, 'error');
                errorCount++;
              } else {
                const calcStr = item.costParts.length > 1 ? ` (${item.costParts.join(' ')})` : '';
                send(`  ✓ [${item.originalIndex + 1}/${allVariants.length}] ${item.label} → ${item.cost.toFixed(2)}€${calcStr}`, 'progress');
                updatedCount++;
              }
            }
          } catch (err: any) {
            console.error(`[apply-stream] CRASH at batch ${batchNum}/${totalBatches}:`, err);
            for (const item of batch) {
              send(`  ❌ [${item.originalIndex + 1}/${allVariants.length}] ${item.label}: ${err?.message || String(err)}`, 'error');
              errorCount++;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

        send('', 'info');
        send('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
        send(`✅ Terminé: ${updatedCount} mise(s) à jour, ${errorCount} erreur(s)`, 'success');

        // Mettre à jour la date de dernière application
        await supabase
          .from('price_rules')
          .update({ last_applied_at: new Date().toISOString() })
          .eq('id', ruleId);

        send('DONE', 'success');

      } catch (error: any) {
        send(`❌ Erreur fatale: ${error?.message || error}`, 'error');
        send('DONE', 'error');
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
