import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

const UPDATE_INVENTORY_COST_MUTATION = `
  mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem {
        id
        unitCost {
          amount
        }
      }
      userErrors {
        field
        message
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
  const target = searchParams.get('target'); // 'shopify' or 'local'

  if (!shopId || !target) {
    return new Response('Missing shopId or target', { status: 400 });
  }

  const encoder = new TextEncoder();
  let streamClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (message: string, type: string = 'info') => {
        if (streamClosed) return;
        try {
          const data = JSON.stringify({ message, type, timestamp: new Date().toISOString() });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          streamClosed = true;
        }
      };

      // Heartbeat to keep the connection alive (every 15s)
      const heartbeat = setInterval(() => {
        if (streamClosed) { clearInterval(heartbeat); return; }
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          streamClosed = true;
          clearInterval(heartbeat);
        }
      }, 15000);

      try {
        send('🚀 Démarrage de l\'application de toutes les règles actives...', 'info');
        send('', 'info');

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

        // Récupérer toutes les règles actives
        const { data: rules, error: rulesError } = await supabase
          .from('price_rules')
          .select(`*, modifiers:price_rule_modifiers(*), option_modifiers:price_rule_option_modifiers(*)`)
          .eq('shop_id', shopId)
          .eq('is_active', true);

        if (rulesError || !rules || rules.length === 0) {
          send('❌ Aucune règle active trouvée', 'error');
          return;
        }

        send(`✓ ${rules.length} règle(s) active(s) trouvée(s)`, 'success');
        send('', 'info');

        if (target === 'shopify') {
          await applyAllOnShopify(shop, rules, send, streamClosed);
        } else if (target === 'ivy') {
          await applyAllOnIvy(rules, send, shopId);
        } else {
          await applyAllLocal(shop, rules, send, shopId);
        }

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

async function applyAllOnShopify(
  shop: any, 
  rules: any[], 
  send: (message: string, type?: string) => void,
  streamClosed: boolean
) {
  const shopDomain = shop.shopify_url;
  const shopToken = shop.shopify_token;

  let totalUpdated = 0;
  let totalErrors = 0;

  for (const rule of rules) {
    send(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'info');
    
    // Vérifier que la règle a un product_type
    if (!rule.product_type) {
      send(`⚠️ Règle ignorée (pas de type de produit défini)`, 'warning');
      continue;
    }
    
    send(`📋 Règle: ${rule.product_type} (base: ${rule.base_price}€)`, 'info');

    // Récupérer les variantes par type de produit
    let allVariants: any[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage) {
      const result = await shopifyGraphQL(
        shopDomain, shopToken,
        GET_VARIANTS_BY_PRODUCT_TYPE_QUERY,
        {
          query: `product_type:"${rule.product_type}"`,
          cursor,
        },
        send
      );

      const pageData = result.data?.productVariants;
      const pageVariants = pageData?.nodes || [];
      allVariants = [...allVariants, ...pageVariants];
      
      hasNextPage = pageData?.pageInfo?.hasNextPage || false;
      cursor = pageData?.pageInfo?.endCursor || null;
    }

    if (allVariants.length === 0) {
      send(`  ⚠️ Aucune variante trouvée`, 'warning');
      continue;
    }

    send(`  └─ ${allVariants.length} variante(s) à traiter`, 'info');

    for (let i = 0; i < allVariants.length; i++) {
      if (streamClosed) {
        console.log(`Stream closed by client at ${i}/${allVariants.length}`);
        break;
      }

      const variant = allVariants[i];
      
      try {
        let cost = rule.base_price;
        const metafields = variant.metafields?.nodes || [];
        const selectedOptions = variant.selectedOptions || [];
        const costParts: string[] = [`${rule.base_price}€`];

        // Appliquer les modificateurs de métachamps
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

        // Appliquer les modificateurs d'options
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

        // Mettre à jour sur Shopify via fetch direct
        const updateResult = await shopifyGraphQL(
          shopDomain, shopToken,
          UPDATE_INVENTORY_COST_MUTATION,
          {
            id: variant.inventoryItem.id,
            input: { cost: cost.toFixed(2) },
          },
          send
        );

        if (updateResult.data?.inventoryItemUpdate?.userErrors?.length > 0) {
          send(`    ❌ ${variant.sku} - ${variant.title}`, 'error');
          totalErrors++;
        } else {
          const calcStr = costParts.length > 1 ? ` (${costParts.join(' ')})` : '';
          send(`    ✓ ${variant.sku} → ${cost.toFixed(2)}€${calcStr}`, 'progress');
          totalUpdated++;
        }

        // Pause de 100ms entre chaque mutation
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (err: any) {
        send(`    ❌ ${variant.sku}: ${err?.message || 'Erreur inconnue'}`, 'error');
        totalErrors++;
        // Pause supplémentaire après une erreur
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Mettre à jour la date de dernière application
    await supabase
      .from('price_rules')
      .update({ last_applied_at: new Date().toISOString() })
      .eq('id', rule.id);
  }

  send('', 'info');
  send('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
  send(`✅ Terminé: ${totalUpdated} mise(s) à jour, ${totalErrors} erreur(s)`, 'success');
}

async function applyAllLocal(
  shop: any, 
  rules: any[], 
  send: (message: string, type?: string) => void,
  shopId: string
) {
  let totalOrderItemsUpdated = 0;
  let totalOrders = 0;

  send('📋 Mise à jour des commandes...', 'info');

  // Récupérer les commandes en cours (non expédiées, non annulées, non remboursées)
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, name, line_items')
    .eq('shop_id', shopId)
    .neq('display_fulfillment_status', 'FULFILLED')
    .is('cancelled_at', null)
    .neq('display_financial_status', 'REFUNDED');

  if (ordersError || !orders) {
    send('❌ Erreur lors de la récupération des commandes', 'error');
    return;
  }

  send(`  └─ ${orders.length} commande(s) à analyser`, 'info');

  for (const order of orders) {
    const lineItems = order.line_items || [];
    let orderUpdated = false;
    const updatedLineItems = [...lineItems];

    for (let i = 0; i < updatedLineItems.length; i++) {
      const item = updatedLineItems[i];
      const itemProductType = item.product_type || item.variant?.product?.product_type || '';

      // Trouver la règle applicable par type de produit
      const matchingRule = rules.find(rule => 
        rule.product_type && 
        itemProductType.toLowerCase() === rule.product_type.toLowerCase()
      );

      if (matchingRule) {
        let cost = matchingRule.base_price;
        const costParts: string[] = [`${matchingRule.base_price}€`];

        // Appliquer les modificateurs de métachamps si disponibles
        // Les métachamps sont stockés dans item.variant.metafields (tableau)
        const itemMetafields = item.variant?.metafields || [];
        for (const modifier of matchingRule.modifiers || []) {
          const match = itemMetafields.find(
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

        // Appliquer les modificateurs d'options
        const itemOptions = item.variant_title?.split(' / ') || [];
        for (const optMod of matchingRule.option_modifiers || []) {
          const match = itemOptions.some(
            (opt: string) => opt.toLowerCase() === optMod.option_value.toLowerCase()
          );

          if (match) {
            cost += optMod.modifier_amount;
            const sign = optMod.modifier_amount >= 0 ? '+' : '';
            costParts.push(`${sign}${optMod.modifier_amount}€ (${optMod.option_value})`);
          }
        }

        if (item.unitCost !== cost) {
          updatedLineItems[i] = {
            ...item,
            unitCost: cost,
            totalCost: cost * (item.quantity || 1),
          };
          orderUpdated = true;
          totalOrderItemsUpdated++;
          
          const calcStr = costParts.length > 1 ? ` (${costParts.join(' ')})` : '';
          send(`  ✓ ${order.name} - ${item.sku || item.title} → ${cost.toFixed(2)}€${calcStr}`, 'progress');
        }
      }
    }

    if (orderUpdated) {
      await supabase
        .from('orders')
        .update({ line_items: updatedLineItems })
        .eq('id', order.id);
      
      totalOrders++;
      send(`  ✓ ${order.name}: articles mis à jour`, 'progress');
    }
  }

  // Mettre à jour les dates de dernière application
  for (const rule of rules) {
    await supabase
      .from('price_rules')
      .update({ last_applied_at: new Date().toISOString() })
      .eq('id', rule.id);
  }

  send('', 'info');
  send('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
  send(`✅ Terminé: ${totalOrderItemsUpdated} article(s) mis à jour dans ${totalOrders} commande(s)`, 'success');
}

async function applyAllOnIvy(
  rules: any[],
  send: (message: string, type?: string) => void,
  shopId: string
) {
  let totalUpdated = 0;
  let totalSkipped = 0;

  // Ne traiter que les règles local_only
  const localRules = rules.filter(r => r.local_only);
  if (localRules.length === 0) {
    send('⚠️ Aucune règle avec "local seulement" activée', 'warning');
    return;
  }

  send(`🔒 ${localRules.length} règle(s) "local seulement" à appliquer`, 'info');

  for (const rule of localRules) {
    send('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');

    if (!rule.product_type) {
      send(`⚠️ Règle ignorée (pas de type de produit défini)`, 'warning');
      continue;
    }

    send(`📋 Règle: ${rule.product_type} (base: ${rule.base_price}€)`, 'info');

    // Récupérer les produits du type correspondant avec leurs variantes
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select(`
        id,
        title,
        product_type,
        option1_name,
        option2_name,
        option3_name,
        variants:product_variants(
          id,
          sku,
          title,
          option1,
          option2,
          option3,
          cost,
          shopify_active
        )
      `)
      .eq('shop_id', shopId)
      .ilike('product_type', rule.product_type)
      .in('status', ['active', 'local', 'draft']);

    if (productsError || !products) {
      send(`  ❌ Erreur: ${productsError?.message || 'Aucun produit'}`, 'error');
      continue;
    }

    // Filtrer les variantes locales seulement
    for (const product of products) {
      (product as any).variants = ((product.variants as any[]) || []).filter(
        (v: any) => v.shopify_active === false
      );
    }

    const totalVariants = products.reduce((sum, p) => sum + ((p.variants as any[])?.length || 0), 0);
    if (totalVariants === 0) {
      send(`  ⚠️ Aucune variante locale trouvée`, 'warning');
      continue;
    }

    send(`  └─ ${totalVariants} variante(s) locale(s) à traiter`, 'info');

    // Charger les métachamps si nécessaire
    let variantMetafieldsMap: Record<string, Array<{ namespace: string; key: string; value: string }>> = {};
    if (rule.modifiers?.length > 0) {
      const variantIds = products.flatMap(p => ((p.variants as any[]) || []).map((v: any) => v.id));
      if (variantIds.length > 0) {
        try {
          const { data: metafieldsData } = await supabase
            .from('variant_metafields')
            .select('variant_id, namespace, key, value')
            .in('variant_id', variantIds);

          if (metafieldsData) {
            for (const mf of metafieldsData) {
              if (!variantMetafieldsMap[mf.variant_id]) {
                variantMetafieldsMap[mf.variant_id] = [];
              }
              variantMetafieldsMap[mf.variant_id].push({
                namespace: mf.namespace,
                key: mf.key,
                value: mf.value,
              });
            }
          }
        } catch {
          // Table not available
        }
      }
    }

    for (const product of products) {
      const optionNames = {
        option1: product.option1_name || 'Option 1',
        option2: product.option2_name || 'Option 2',
        option3: product.option3_name || 'Option 3',
      };

      for (const variant of (product.variants as any[]) || []) {
        let cost = rule.base_price;
        const costParts: string[] = [`${rule.base_price}€`];

        // Modificateurs métachamps
        const metafields = variantMetafieldsMap[variant.id] || [];
        for (const modifier of rule.modifiers || []) {
          const match = metafields.find(
            (mf) =>
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

        // Modificateurs d'options
        const selectedOptions: Array<{ name: string; value: string }> = [];
        if (variant.option1) selectedOptions.push({ name: optionNames.option1, value: variant.option1 });
        if (variant.option2) selectedOptions.push({ name: optionNames.option2, value: variant.option2 });
        if (variant.option3) selectedOptions.push({ name: optionNames.option3, value: variant.option3 });

        for (const optMod of rule.option_modifiers || []) {
          const match = selectedOptions.find(
            (opt) =>
              opt.name.toLowerCase() === optMod.option_name.toLowerCase() &&
              opt.value.toLowerCase() === optMod.option_value.toLowerCase()
          );
          if (match) {
            cost += optMod.modifier_amount;
            const sign = optMod.modifier_amount >= 0 ? '+' : '';
            costParts.push(`${sign}${optMod.modifier_amount}€ (${optMod.option_value})`);
          }
        }

        const roundedCost = Math.round(cost * 100) / 100;
        const currentCost = variant.cost || 0;

        if (Math.abs(roundedCost - currentCost) < 0.005) {
          totalSkipped++;
          continue;
        }

        const { error: updateError } = await supabase
          .from('product_variants')
          .update({ cost: roundedCost })
          .eq('id', variant.id);

        if (updateError) {
          send(`    ❌ ${variant.sku}: ${updateError.message}`, 'error');
        } else {
          const calcStr = costParts.length > 1 ? ` (${costParts.join(' ')})` : '';
          send(`    ✓ ${variant.sku || 'no-sku'} → ${roundedCost.toFixed(2)}€${calcStr}`, 'progress');
          totalUpdated++;
        }
      }
    }

    // Mettre à jour la date de dernière application
    await supabase
      .from('price_rules')
      .update({ last_applied_at: new Date().toISOString() })
      .eq('id', rule.id);
  }

  send('', 'info');
  send('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
  send(`✅ Terminé: ${totalUpdated} mise(s) à jour, ${totalSkipped} inchangée(s)`, 'success');
}
