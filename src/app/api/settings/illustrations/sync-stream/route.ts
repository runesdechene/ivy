import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAGE_SIZE = 50;

// Query: for each product, fetch the `custom.illustration_produit` metafield,
// which references a Metaobject. Pull all fields of that metaobject — we then
// find the first field whose reference is a MediaImage and extract its URL.
const GET_PRODUCTS_WITH_ILLUSTRATION_QUERY = `
  query getProductsWithIllustration($cursor: String) {
    products(first: ${PAGE_SIZE}, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        illustrationMetafield: metafield(namespace: "custom", key: "illustration_produit") {
          reference {
            ... on Metaobject {
              id
              handle
              fields {
                key
                value
                reference {
                  ... on MediaImage {
                    image { url }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

interface MetaobjectField {
  key: string;
  value: string | null;
  reference?: { image?: { url?: string | null } | null } | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractIllustrationUrl(product: any): string | null {
  const metaobject = product?.illustrationMetafield?.reference;
  if (!metaobject?.fields) return null;
  for (const field of metaobject.fields as MetaobjectField[]) {
    const url = field?.reference?.image?.url;
    if (url) return url;
  }
  return null;
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
    try {
      const res = await fetch(url, {
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
        send(`  ⏳ HTTP 429 — pause ${(waitMs / 1000).toFixed(1)}s`, 'info');
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
      if (attempt < maxRetries) {
        const waitMs = 1000 * (attempt + 1);
        send(`  ⚠️ Erreur réseau (${(err?.message || '').slice(0, 80)}), retry dans ${(waitMs / 1000).toFixed(0)}s...`, 'info');
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
  const cursorParam = searchParams.get('cursor');
  const offsetParam = parseInt(searchParams.get('offset') || '0', 10);

  if (!shopId) {
    return new Response('Missing shopId', { status: 400 });
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

        if (isFirstChunk) {
          send('🚀 Synchronisation des illustrations depuis Shopify...', 'info');
          send(`✓ Boutique: ${shop.name || shop.shopify_url}`, 'success');
          send(`  └─ Metafield source: custom.illustration_produit`, 'info');
        }

        const pageNum = Math.floor(offsetParam / PAGE_SIZE) + 1;
        send(`📦 Page ${pageNum}: récupération des produits...`, 'info');

        const result = await shopifyGraphQL(
          shop.shopify_url,
          shop.shopify_token,
          GET_PRODUCTS_WITH_ILLUSTRATION_QUERY,
          { cursor: cursorParam || null },
          send
        );

        const pageData = result.data?.products;
        const pageProducts = pageData?.nodes || [];
        const hasNextPage = pageData?.pageInfo?.hasNextPage || false;
        const nextCursor = pageData?.pageInfo?.endCursor || null;

        send(`  └─ ${pageProducts.length} produit(s) récupéré(s)`, 'info');

        let updatedCount = 0;
        let missingCount = 0;
        let errorCount = 0;

        for (let i = 0; i < pageProducts.length; i++) {
          if (streamClosed) break;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const product = pageProducts[i] as any;
          const globalIndex = offsetParam + i;
          const shopifyId = product.id.replace('gid://shopify/Product/', '');
          const illustrationUrl = extractIllustrationUrl(product);

          if (!illustrationUrl) {
            send(`  ⚠️ [${globalIndex + 1}] ${product.title}: aucune illustration`, 'warning');
            missingCount++;
          }

          const { error: updateError } = await supabase
            .from('products')
            .update({ illustration_url: illustrationUrl })
            .eq('shop_id', shopId)
            .eq('shopify_id', shopifyId);

          if (updateError) {
            send(`  ❌ [${globalIndex + 1}] ${product.title}: ${updateError.message}`, 'error');
            errorCount++;
          } else if (illustrationUrl) {
            send(`  ✓ [${globalIndex + 1}] ${product.title}`, 'progress');
            updatedCount++;
          }
        }

        sendDone({
          nextCursor: hasNextPage ? nextCursor : null,
          offset: offsetParam + pageProducts.length,
          updatedCount,
          missingCount,
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
