import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAGE_SIZE = 50;

const GET_PRODUCTS_QUERY = `
  query getProducts($cursor: String) {
    products(first: ${PAGE_SIZE}, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        productType
        descriptionHtml
      }
    }
  }
`;

const UPDATE_PRODUCT_MUTATION = `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id title }
      userErrors { field message }
    }
  }
`;

interface Condition {
  field: 'title' | 'product_type';
  operator: 'contains';
  value: string;
}

function matchesConditions(product: { title: string; productType: string }, conditions: Condition[]): boolean {
  if (conditions.length === 0) return false;

  return conditions.every(cond => {
    const fieldValue = cond.field === 'title' ? product.title : product.productType;
    if (!fieldValue) return false;

    if (cond.operator === 'contains') {
      return fieldValue.toLowerCase().includes(cond.value.toLowerCase());
    }
    return false;
  });
}

async function shopifyGraphQL(
  shopDomain: string,
  token: string,
  query: string,
  variables: Record<string, unknown>,
  send: (message: string, type?: string) => void,
  maxRetries = 6
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (json.errors?.some((e: any) => e.extensions?.code === 'THROTTLED')) {
        const waitMs = 2000 * (attempt + 1);
        send(`  ⏳ Throttle GraphQL — pause ${(waitMs / 1000).toFixed(0)}s`, 'info');
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      const errMsg = err?.message || String(err);
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
  const descriptionId = searchParams.get('descriptionId');
  const cursorParam = searchParams.get('cursor');
  const offsetParam = parseInt(searchParams.get('offset') || '0', 10);

  if (!shopId || !descriptionId) {
    return new Response('Missing shopId or descriptionId', { status: 400 });
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

      const heartbeat = setInterval(() => {
        if (streamClosed) { clearInterval(heartbeat); return; }
        send('', 'keepalive');
      }, 10000);

      const isFirstChunk = !cursorParam;

      try {
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

        const { data: desc, error: descError } = await supabase
          .from('product_descriptions')
          .select('*')
          .eq('id', descriptionId)
          .single();

        if (descError || !desc) {
          send('❌ Règle de description non trouvée', 'error');
          sendDone();
          return;
        }

        const conditions = (desc.conditions || []) as Condition[];

        if (isFirstChunk) {
          send('🚀 Application de la description sur Shopify...', 'info');
          send(`✓ Boutique: ${shop.name || shop.shopify_url}`, 'success');
          send(`✓ Règle: ${desc.name}`, 'success');
          send(`  └─ ${conditions.length} condition(s)`, 'info');
          for (const c of conditions) {
            send(`     ${c.field} ${c.operator} "${c.value}"`, 'info');
          }
        }

        const shopDomain = shop.shopify_url;
        const shopToken = shop.shopify_token;

        const pageNum = Math.floor(offsetParam / PAGE_SIZE) + 1;
        send(`📦 Page ${pageNum}: récupération des produits...`, 'info');

        const result = await shopifyGraphQL(
          shopDomain, shopToken,
          GET_PRODUCTS_QUERY,
          { cursor: cursorParam || null },
          send
        );

        const pageData = result.data?.products;
        const pageProducts = pageData?.nodes || [];
        const hasNextPage = pageData?.pageInfo?.hasNextPage || false;
        const nextCursor = pageData?.pageInfo?.endCursor || null;

        send(`  └─ ${pageProducts.length} produit(s) récupéré(s)`, 'info');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const matched = pageProducts.filter((p: any) => matchesConditions(p, conditions));
        send(`  └─ ${matched.length} correspondant(s) aux conditions`, 'info');

        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (let i = 0; i < matched.length; i++) {
          if (streamClosed) break;

          const product = matched[i];
          const globalIndex = offsetParam + i;

          if (product.descriptionHtml === desc.description_html) {
            skippedCount++;
            continue;
          }

          try {
            const updateResult = await shopifyGraphQL(
              shopDomain, shopToken,
              UPDATE_PRODUCT_MUTATION,
              { input: { id: product.id, descriptionHtml: desc.description_html } },
              send
            );

            if (updateResult.data?.productUpdate?.userErrors?.length > 0) {
              const err = updateResult.data.productUpdate.userErrors[0].message;
              send(`  ❌ [${globalIndex + 1}] ${product.title}: ${err}`, 'error');
              errorCount++;
            } else {
              send(`  ✓ [${globalIndex + 1}] ${product.title}`, 'progress');
              updatedCount++;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (err: any) {
            send(`  ❌ [${globalIndex + 1}] ${product.title}: ${err?.message || 'Erreur'}`, 'error');
            errorCount++;
          }
        }

        // Update timestamp only on last chunk
        if (!hasNextPage) {
          await supabase
            .from('product_descriptions')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', descriptionId);
        }

        sendDone({
          nextCursor: hasNextPage ? nextCursor : null,
          offset: offsetParam + pageProducts.length,
          updatedCount,
          skippedCount,
          errorCount,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
