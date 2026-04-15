# Product Illustrations Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher l'illustration de chaque produit (stockée dans les métaobjets Shopify) à côté de chaque groupe SKU du feuillet de production, pour éviter les erreurs d'impression à l'atelier.

**Architecture:** Colonne `illustration_url TEXT` ajoutée à `products`, peuplée par un endpoint SSE chunké (pattern cursor-based identique à price-rules) qui récupère les URLs via GraphQL Shopify depuis le métaobjet référencé par `custom.illustration_produit`. Page de paramètres dédiée pour déclencher la sync. Enrichissement de l'API `supplier_orders/[orderId]` pour joindre `illustration_url` aux items. Rendu en miniature cliquable (zoom modal) dans le feuillet.

**Tech Stack:** Next.js 16 App Router, Mantine 7, Supabase, Shopify Admin GraphQL API 2024-10, TypeScript strict, pnpm.

**Conventions clés du projet :**
- Pas de framework de tests → vérification manuelle via `pnpm dev` + UI browser.
- TypeScript strict, `no any` (utiliser `unknown` ou types précis ; `any` uniquement toléré pour les retours Shopify GraphQL non typés, accompagné d'un `eslint-disable`).
- Path alias `@/*` → `./src/*`.
- Tous les endpoints SSE suivent la signature `useTerminalStream` avec `send(message, type)` et `sendDone({...})`.
- Toute donnée Supabase filtrée par `shop_id` (RLS actif).

---

## Task 1: Migration DB

**Files:**
- Create: `supabase/migrations/038_product_illustrations.sql`

- [ ] **Step 1: Create migration file**

Fichier `supabase/migrations/038_product_illustrations.sql`:

```sql
-- Product illustration URLs synced from Shopify metaobjects
ALTER TABLE products ADD COLUMN IF NOT EXISTS illustration_url TEXT;

COMMENT ON COLUMN products.illustration_url IS
  'URL of the product illustration image, fetched from the Shopify metaobject referenced by the custom.illustration_produit metafield. NULL = not synced or no illustration set on Shopify.';
```

- [ ] **Step 2: Apply the migration to the Supabase instance**

L'utilisateur applique la migration dans son Supabase (Dashboard → SQL Editor, ou via la CLI Supabase). Demander à l'utilisateur de confirmer que la migration a bien tourné avant de continuer.

Commande de vérification attendue (peut être donnée à l'utilisateur) :
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'products' AND column_name = 'illustration_url';
```
Résultat attendu : une ligne `illustration_url | text`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/038_product_illustrations.sql
git commit -m "feat(db): add products.illustration_url column for Shopify metaobject sync"
```

---

## Task 2: API route — sync stream chunké

**Files:**
- Create: `src/app/api/settings/illustrations/sync-stream/route.ts`

- [ ] **Step 1: Create the sync-stream route**

Fichier `src/app/api/settings/illustrations/sync-stream/route.ts` — pattern identique à `src/app/api/settings/price-rules/apply-stream/route.ts` mais adapté pour fetch produit → metafield → metaobject → image URL.

```typescript
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
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: Exit code 0, aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/settings/illustrations/sync-stream/route.ts
git commit -m "feat(api): add chunked SSE endpoint to sync product illustrations from Shopify metaobjects"
```

---

## Task 3: Page de paramètres `/parametres/illustrations`

**Files:**
- Create: `src/app/parametres/illustrations/page.tsx`
- Modify: `src/layout/ParametresLayout.tsx:7` (import icon) and `src/layout/ParametresLayout.tsx:41-45` (add menu entry)

- [ ] **Step 1: Create the settings page**

Fichier `src/app/parametres/illustrations/page.tsx`:

```typescript
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Title, Text, Paper, Stack, Group, Button, Switch, Badge,
  SimpleGrid, Loader, Center, Image, Tooltip,
} from '@mantine/core';
import { IconRefresh, IconPhoto, IconPhotoOff } from '@tabler/icons-react';
import { useShop } from '@/context/ShopContext';
import { useTerminalStream } from '@/hooks/useTerminalStream';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface ProductRow {
  id: string;
  title: string;
  illustration_url: string | null;
}

export default function IllustrationsPage() {
  const { currentShop } = useShop();
  const { streamFromUrl, log: terminalLog, endSync } = useTerminalStream();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);

  const fetchProducts = useCallback(async () => {
    if (!currentShop) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('products')
      .select('id, title, illustration_url')
      .eq('shop_id', currentShop.id)
      .neq('status', 'local')
      .order('title', { ascending: true });
    if (!error && data) setProducts(data as ProductRow[]);
    setLoading(false);
  }, [currentShop]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const visible = useMemo(
    () => onlyMissing ? products.filter(p => !p.illustration_url) : products,
    [products, onlyMissing]
  );

  const missingCount = useMemo(
    () => products.filter(p => !p.illustration_url).length,
    [products]
  );

  const runSync = async () => {
    if (!currentShop) return;
    setSyncing(true);

    let cursor: string | null = null;
    let offset = 0;
    let totalUpdated = 0;
    let totalMissing = 0;
    let totalErrors = 0;
    let chunk = 0;

    do {
      const params = new URLSearchParams({ shopId: currentShop.id });
      if (cursor) params.set('cursor', cursor);
      if (offset > 0) params.set('offset', offset.toString());

      let nextCursor: string | null = null;

      await streamFromUrl(`/api/settings/illustrations/sync-stream?${params}`, {
        title: chunk === 0 ? 'Sync illustrations' : undefined,
        noStartSync: chunk > 0,
        noEndSync: true,
        onComplete: (data) => {
          nextCursor = (data?.nextCursor as string) || null;
          offset = (data?.offset as number) || offset;
          totalUpdated += (data?.updatedCount as number) || 0;
          totalMissing += (data?.missingCount as number) || 0;
          totalErrors += (data?.errorCount as number) || 0;
        },
      });

      cursor = nextCursor;
      chunk++;
    } while (cursor);

    terminalLog('', 'info');
    terminalLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    terminalLog(`✅ Terminé: ${totalUpdated} avec illustration, ${totalMissing} sans, ${totalErrors} erreur(s)`, 'success');
    endSync();

    await fetchProducts();
    setSyncing(false);
  };

  if (loading) {
    return <Center h={400}><Loader size="lg" /></Center>;
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Illustrations produits</Title>
        <Text c="dimmed" size="sm">
          Les illustrations sont récupérées depuis les métaobjets Shopify (metafield <code>custom.illustration_produit</code>).
          Elles sont affichées sur le feuillet de production pour guider l'atelier.
        </Text>
      </div>

      <Group justify="space-between">
        <Group gap="md">
          <Badge variant="light" color="blue" size="lg">
            {products.length} produit(s)
          </Badge>
          <Badge variant="light" color={missingCount > 0 ? 'orange' : 'green'} size="lg">
            {missingCount} sans illustration
          </Badge>
        </Group>
        <Switch
          label="Afficher uniquement les produits sans illustration"
          checked={onlyMissing}
          onChange={(e) => setOnlyMissing(e.currentTarget.checked)}
        />
      </Group>

      {visible.length === 0 ? (
        <Paper withBorder p="xl" radius="md">
          <Text c="dimmed" ta="center">
            {onlyMissing ? 'Toutes les illustrations sont à jour.' : 'Aucun produit.'}
          </Text>
        </Paper>
      ) : (
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 6 }} spacing="md">
          {visible.map(p => (
            <Paper key={p.id} withBorder p="sm" radius="md">
              <Stack gap="xs" align="center">
                {p.illustration_url ? (
                  <Image
                    src={p.illustration_url}
                    alt={p.title}
                    w={80}
                    h={80}
                    fit="contain"
                    radius="sm"
                  />
                ) : (
                  <Tooltip label="Illustration manquante">
                    <div style={{
                      width: 80, height: 80, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', background: '#f4f4f4', borderRadius: 6,
                    }}>
                      <IconPhotoOff size={24} color="#999" />
                    </div>
                  </Tooltip>
                )}
                <Text size="xs" ta="center" lineClamp={2} fw={500}>{p.title}</Text>
                {p.illustration_url ? (
                  <Badge size="xs" color="green" variant="light" leftSection={<IconPhoto size={10} />}>
                    OK
                  </Badge>
                ) : (
                  <Badge size="xs" color="orange" variant="light">
                    Manquante
                  </Badge>
                )}
              </Stack>
            </Paper>
          ))}
        </SimpleGrid>
      )}

      <Paper withBorder p="md" radius="md" bg="gray.0">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Opération rare. À lancer après avoir ajouté ou modifié des illustrations côté Shopify.
          </Text>
          <Button
            variant="light"
            color="gray"
            leftSection={<IconRefresh size={16} />}
            onClick={runSync}
            loading={syncing}
          >
            Resynchroniser depuis Shopify
          </Button>
        </Group>
      </Paper>
    </Stack>
  );
}
```

- [ ] **Step 2: Add menu entry in ParametresLayout**

Dans `src/layout/ParametresLayout.tsx`, modifier la ligne 7 pour importer `IconPhoto`:

```typescript
import { IconPalette, IconTag, IconShoppingCart, IconCurrencyEuro, IconFileDescription, IconPhoto } from '@tabler/icons-react';
```

Puis ajouter une entrée dans le tableau `menuCategories` (après l'entrée "Descriptions", lignes 41-45) :

```typescript
        {
          href: '/parametres/descriptions',
          label: 'Descriptions',
          icon: IconFileDescription,
        },
        {
          href: '/parametres/illustrations',
          label: 'Illustrations',
          icon: IconPhoto,
        },
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: Exit code 0, aucune erreur.

- [ ] **Step 4: Manual verification**

1. `pnpm dev`
2. Naviguer vers `http://localhost:3000/parametres/illustrations`
3. Vérifier : la page s'affiche, le menu de gauche liste "Illustrations" avec l'icône, l'état initial montre tous les produits avec "Manquante" (puisque `illustration_url` est `NULL` pour tous).
4. Cliquer sur "Resynchroniser depuis Shopify" → le terminal flottant s'ouvre, la progression défile page par page, et à la fin les produits ayant une illustration apparaissent avec leur miniature.

Si aucun produit n'a d'illustration après sync, vérifier dans l'admin Shopify qu'un produit test a bien un métachamp `custom.illustration_produit` peuplé.

- [ ] **Step 5: Commit**

```bash
git add src/app/parametres/illustrations/page.tsx src/layout/ParametresLayout.tsx
git commit -m "feat(ui): add Illustrations settings page with sync button and missing-filter"
```

---

## Task 4: Enrichir l'API `supplier_orders/[orderId]` avec `illustration_url`

**Files:**
- Modify: `src/app/api/suppliers/orders/[orderId]/route.ts:36-44`

- [ ] **Step 1: Modify the GET handler to join illustration_url**

Dans `src/app/api/suppliers/orders/[orderId]/route.ts`, remplacer le bloc lignes 36-44 (fetch des items) par une requête enrichie qui joint l'illustration via `variant_id` → `product_variants` → `products.illustration_url`.

Avant (lignes 36-44) :
```typescript
    const { data: items, error: itemsError } = await supabase
      .from('supplier_order_items')
      .select('*')
      .eq('order_id', orderId)
      .order('sku');

    if (itemsError) {
      console.error('Error fetching items:', itemsError);
    }
```

Après :
```typescript
    const { data: items, error: itemsError } = await supabase
      .from('supplier_order_items')
      .select('*')
      .eq('order_id', orderId)
      .order('sku');

    if (itemsError) {
      console.error('Error fetching items:', itemsError);
    }

    // Enrich items with illustration_url from products table
    // Match via variant_id → product_variants.shopify_id → products.illustration_url
    let enrichedItems = items || [];
    if (enrichedItems.length > 0) {
      const variantIds = enrichedItems
        .map(i => i.variant_id)
        .filter((v): v is string => !!v);

      if (variantIds.length > 0) {
        const { data: variants } = await supabase
          .from('product_variants')
          .select('shopify_id, product_id, products!inner(illustration_url)')
          .eq('products.shop_id', shopId)
          .in('shopify_id', variantIds);

        // Build map: variant_id → illustration_url
        const illustrationMap: Record<string, string | null> = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (variants as any[] | null)?.forEach(v => {
          illustrationMap[v.shopify_id] = v.products?.illustration_url || null;
        });

        enrichedItems = enrichedItems.map(item => ({
          ...item,
          illustration_url: item.variant_id ? (illustrationMap[item.variant_id] || null) : null,
        }));
      }
    }

    return NextResponse.json({
      order,
      items: enrichedItems,
    });
```

Et supprimer le `return NextResponse.json({ order, items: items || [] });` plus bas (ligne 46-49 dans l'original) puisqu'il est remplacé.

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: Exit code 0, aucune erreur.

- [ ] **Step 3: Manual verification**

1. `pnpm dev`
2. Naviguer vers une commande stock existante : `/ivy/commandes/stock/{un-order-id}/feuillet`
3. Ouvrir DevTools → Network → inspecter la réponse de `/api/suppliers/orders/{orderId}` → chaque item doit avoir un champ `illustration_url` (string ou null).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/suppliers/orders/[orderId]/route.ts
git commit -m "feat(api): join illustration_url into supplier order items response"
```

---

## Task 5: Afficher l'illustration dans le feuillet de production

**Files:**
- Modify: `src/app/ivy/commandes/stock/[orderId]/feuillet/page.tsx`

Interprétation de la spec : chaque groupe SKU partage la même illustration (une illustration par produit, donc par SKU). Plutôt qu'une colonne redondante sur chaque ligne de variante, on affiche l'illustration **une fois** dans l'en-tête du groupe SKU, à gauche du titre SKU, en miniature cliquable.

- [ ] **Step 1: Add illustration_url to OrderItem interface**

Dans `src/app/ivy/commandes/stock/[orderId]/feuillet/page.tsx`, modifier l'interface `OrderItem` (autour de la ligne 19) pour ajouter le champ :

```typescript
interface OrderItem {
  id: string;
  variant_id: string | null;
  product_title: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  is_validated: boolean;
  validated_at: string | null;
  metafields?: Record<string, string>;
  illustration_url?: string | null;
}
```

- [ ] **Step 2: Add illustration_url to GroupedVariant interface**

Modifier `GroupedVariant` (ligne 37) :

```typescript
interface GroupedVariant {
  sku: string;
  color: string;
  size: string;
  items: OrderItem[];
  totalQuantity: number;
  validatedCount: number;
  illustrationUrl: string | null;
}
```

- [ ] **Step 3: Populate illustrationUrl when grouping**

Dans la fonction `useMemo` de `variantsBySku` (autour de la ligne 96), lors de la création d'un nouveau group, ajouter le champ. Dans les deux branches (création nouveau group et push dans existing), l'illustration est celle du premier item.

Remplacer le bloc `variants.push({...})` par :

```typescript
        variants.push({
          sku,
          color,
          size,
          items: [item],
          totalQuantity: 1,
          validatedCount: item.is_validated ? 1 : 0,
          illustrationUrl: item.illustration_url || null,
        });
```

- [ ] **Step 4: Add imports and modal state**

En haut du fichier, après les imports existants de `@mantine/core`, ajouter `Modal` à l'import :

```typescript
import {
  Title, Text, Paper, Table, Button, Group, Badge,
  Checkbox, Loader, Center, Stack, Progress, ActionIcon, Tooltip, Modal, Image,
} from '@mantine/core';
```

Ajouter `IconPhotoOff` à l'import d'icônes :

```typescript
import { IconArrowLeft, IconChecklist, IconCheckbox, IconSquare, IconPhotoOff } from '@tabler/icons-react';
```

Ajouter un state pour la modal de zoom juste après les autres `useState` (autour de la ligne 55) :

```typescript
  const [zoomedImage, setZoomedImage] = useState<{ url: string; title: string } | null>(null);
```

- [ ] **Step 5: Render illustration in SKU group header**

Dans le JSX du rendu des groupes SKU, repérer le bloc `<Group gap="sm">` qui contient le `<Title order={4}>` du SKU (ligne ~288). L'entourer d'un Group wrap: nowrap et insérer la miniature à gauche :

Remplacer :
```typescript
                <Stack key={sku} gap="xs">
                  <Group gap="sm">
                    <Title order={4} className={styles.skuTitle}>
                      {sku}
                      <Badge ml="sm" variant="light" color={skuValidated === skuTotal ? 'green' : 'gray'}>
                        {skuValidated}/{skuTotal}
                      </Badge>
                    </Title>
```

Par :
```typescript
                <Stack key={sku} gap="xs">
                  <Group gap="sm" wrap="nowrap" align="center">
                    {groups[0]?.illustrationUrl ? (
                      <Image
                        src={groups[0].illustrationUrl}
                        alt={sku}
                        w={64}
                        h={64}
                        fit="contain"
                        radius="sm"
                        style={{ cursor: 'pointer', border: '1px solid #e0e0e0', flexShrink: 0 }}
                        onClick={() => setZoomedImage({
                          url: groups[0].illustrationUrl!,
                          title: `${sku} — ${groups[0].items[0]?.product_title || ''}`,
                        })}
                      />
                    ) : (
                      <Tooltip label="Illustration manquante — synchroniser dans Paramètres → Illustrations">
                        <div style={{
                          width: 64, height: 64, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', background: '#f4f4f4', borderRadius: 6,
                          border: '1px solid #e0e0e0', flexShrink: 0,
                        }}>
                          <IconPhotoOff size={24} color="#999" />
                        </div>
                      </Tooltip>
                    )}
                    <Title order={4} className={styles.skuTitle}>
                      {sku}
                      <Badge ml="sm" variant="light" color={skuValidated === skuTotal ? 'green' : 'gray'}>
                        {skuValidated}/{skuTotal}
                      </Badge>
                    </Title>
```

- [ ] **Step 6: Add the zoom modal at the bottom of the JSX**

Juste avant la fermeture de `</div>` finale (la `</div>` qui clôt `<div className={styles.pageContainer}>`, ligne ~384), ajouter la modal :

```typescript
      <Modal
        opened={!!zoomedImage}
        onClose={() => setZoomedImage(null)}
        title={zoomedImage?.title || ''}
        size="xl"
        centered
      >
        {zoomedImage && (
          <Image src={zoomedImage.url} alt={zoomedImage.title} fit="contain" />
        )}
      </Modal>
```

- [ ] **Step 7: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: Exit code 0, aucune erreur.

- [ ] **Step 8: Manual verification**

1. `pnpm dev`
2. Avoir préalablement lancé la sync illustrations sur au moins un produit (Task 3).
3. Naviguer vers `/ivy/commandes/stock/{orderId}/feuillet` sur une commande qui contient des items dont le produit associé a une illustration synchronisée.
4. Vérifier :
   - Chaque groupe SKU affiche son illustration en miniature 64×64 à gauche du titre SKU.
   - Clic sur la miniature → modal avec l'image en grand + titre produit.
   - Pour les SKU dont le produit n'a pas d'illustration, un placeholder gris avec icône s'affiche (avec tooltip).
5. Tester en réduisant la largeur de fenêtre : la miniature reste à gauche (flex-shrink: 0), le titre wrap si nécessaire.

- [ ] **Step 9: Commit**

```bash
git add src/app/ivy/commandes/stock/[orderId]/feuillet/page.tsx
git commit -m "feat(feuillet): show product illustration in each SKU group header with zoom modal"
```

---

## Task 6: Mettre à jour CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (sections "Database" et "Key API routes")

- [ ] **Step 1: Update the Database section**

Dans `CLAUDE.md`, trouver la section `## Database (Supabase)`. Dans la phrase "Core tables:", le détail de chaque table est absent mais on documente la colonne ailleurs. Ajouter une nouvelle ligne après la ligne "Core tables:" :

Localiser :
```markdown
Core tables: `shops`, `user_shops`, `orders`, `line_item_checks`, `order_progress`, `price_rules`, `price_rule_modifiers`, `price_rule_option_modifiers`, `billing_notes`, `monthly_balance`, `syncs`, `order_invoices`, `order_costs`, `supplier_orders`, `supplier_order_items`, `products`, `product_variants`, `inventory_levels`, `locations`, `stock_movements`, `metafield_config`.
```

Ajouter en dessous :
```markdown

**Notable columns :**
- `products.illustration_url` : URL de l'illustration produit (source : métaobjet Shopify via `custom.illustration_produit`). Peuplée par `/api/settings/illustrations/sync-stream`. Affichée sur le feuillet de production.
- `product_descriptions` : modèles de descriptions HTML avec conditions de match (title/product_type contient X), appliquées en masse sur Shopify.
```

- [ ] **Step 2: Update the Key API routes section**

Dans `CLAUDE.md`, trouver la section `### Key API routes`. Ajouter la nouvelle route dans la liste :

Après la ligne `- GET /api/settings/price-rules/apply-all-stream — bulk apply all active rules` (ou à la fin de la liste des `/api/settings/...` si l'ordre diffère), ajouter :

```markdown
- `GET /api/settings/illustrations/sync-stream` — chunked SSE sync of product illustrations from Shopify metaobjects (`custom.illustration_produit`) into `products.illustration_url`
- `GET /api/settings/product-descriptions?shopId=` — CRUD for description templates (GET/POST/PUT/DELETE)
- `GET /api/settings/product-descriptions/apply-stream` — chunked SSE apply of a description template to matching Shopify products
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document products.illustration_url and new illustrations/descriptions API routes"
```

---

## Task 7: Final smoke test

- [ ] **Step 1: End-to-end flow**

1. Depuis zéro (dev server relancé), aller dans `/parametres/illustrations`.
2. Vérifier que le menu `Paramètres` liste bien "Illustrations" avec l'icône photo.
3. Cliquer "Resynchroniser depuis Shopify", observer le terminal flottant : progression par page, résumé final `X avec illustration, Y sans, 0 erreur(s)`.
4. Après sync, les miniatures des produits ayant une illustration apparaissent sur la page paramètres. Le toggle "Afficher uniquement les produits sans illustration" filtre correctement.
5. Naviguer vers `/ivy/commandes/stock/{orderId}/feuillet` sur une commande pertinente.
6. Chaque groupe SKU affiche son illustration à gauche (ou placeholder). Clic miniature → zoom modal.
7. Les checkboxes de validation fonctionnent toujours normalement.

- [ ] **Step 2: Verify no regressions**

Visiter rapidement les autres pages de paramètres (`/parametres/descriptions`, `/parametres/prix`, `/parametres/couleurs`, `/parametres/metachamps`) pour confirmer que l'ajout du nouveau lien n'a rien cassé.

- [ ] **Step 3: Final build check**

Run: `pnpm build`
Expected: Build réussit sans erreur. Si des warnings apparaissent sur les fichiers modifiés uniquement, les évaluer et corriger si nécessaire.

---

## Notes d'implémentation

### Découverte du nom du champ image dans le métaobjet

La query GraphQL utilise le pattern `fields { key, value, reference { ... on MediaImage { image { url } } } }` qui liste **tous les champs** du métaobjet Illustrations et tente d'extraire une URL d'image pour chaque. La fonction `extractIllustrationUrl` prend la **première** URL non-nulle trouvée. Cela rend le code robuste au nom exact du champ (image, illustration, etc.) sans configuration supplémentaire.

**Si un métaobjet a plusieurs champs image** (ex: `image_principale` + `image_secondaire`), la première par ordre de déclaration du métaobjet sera utilisée. Si ce n'est pas le comportement voulu, il faudra filtrer par `field.key === 'image_principale'` (nom exact à découvrir dans l'admin Shopify).

### Pourquoi `.neq('status', 'local')` dans la page paramètres

La sync inventaire existante marque les produits absents de Shopify comme `status = 'local'` (ligne 252 de `sync-stream/route.ts` inventory). On les exclut de la page illustrations pour ne pas polluer la liste avec des produits qui n'existent plus côté Shopify et ne peuvent donc pas avoir d'illustration.

### Budget Netlify

Avec `PAGE_SIZE = 50` et une requête GraphQL unique par page (pas de mutations à appliquer), le chunk devrait se terminer en ~2-5s. Très confortable sous la limite 26s.
