import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { syncVariantMetafields, deduplicateLocalVariants } from '@/lib/shopify-metafields';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Max batches of 50 inventory items per chunk (~1s each → ~15-20s per chunk)
const MAX_BATCHES_PER_CHUNK = 15;

type SendFn = (message: string, type?: string) => void;
type SendDoneFn = (extra?: Record<string, unknown>) => void;

// ─── Helpers ───────────────────────────────────────────────────────

async function shopifyFetchRetry(
  url: string, token: string, send: SendFn, batchLabel: string, maxRetries = 3
): Promise<any | null> {
  let retries = 0;
  while (retries <= maxRetries) {
    const delay = retries === 0 ? 500 : 1000 * Math.pow(2, retries);
    await new Promise(r => setTimeout(r, delay));

    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    });

    if (res.ok) return res.json();
    if (res.status === 429) {
      retries++;
      if (retries <= maxRetries) send(`    ⏳ Rate limit, retry ${retries}/${maxRetries}...`, 'warning');
      else send(`    ❌ ${batchLabel}: rate limit après ${maxRetries} retries`, 'error');
    } else {
      send(`    ❌ ${batchLabel}: erreur ${res.status}`, 'error');
      return null;
    }
  }
  return null;
}

async function loadActiveVariants(shopId: string, productType: string | null) {
  let pq = supabase.from('products').select('id').eq('shop_id', shopId).neq('status', 'local');
  if (productType) pq = pq.eq('product_type', productType);
  const { data: products } = await pq;
  const productUuids = products?.map((p: any) => p.id) || [];

  const allVariants: any[] = [];
  for (let i = 0; i < productUuids.length; i += 50) {
    const batch = productUuids.slice(i, i + 50);
    let from = 0;
    while (true) {
      const { data } = await supabase
        .from('product_variants')
        .select('id, shopify_id, inventory_item_id')
        .in('product_id', batch)
        .eq('shopify_active', true)
        .range(from, from + 999);
      if (data && data.length > 0) {
        allVariants.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      } else break;
    }
  }

  const inventoryItemIds: string[] = [];
  const inventoryItemToVariantUuid: Record<string, string> = {};
  const variantIdMap: Record<string, string> = {};

  for (const v of allVariants) {
    variantIdMap[v.shopify_id] = v.id;
    if (v.inventory_item_id) {
      inventoryItemIds.push(v.inventory_item_id);
      inventoryItemToVariantUuid[v.inventory_item_id] = v.id;
    }
  }

  return { productUuids, inventoryItemIds, inventoryItemToVariantUuid, variantIdMap };
}

// ─── Main handler ──────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get('shopId');
  const productType = searchParams.get('productType');
  const phase = searchParams.get('phase') || 'products';
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  if (!shopId) {
    return new Response('Missing shopId', { status: 400 });
  }

  const encoder = new TextEncoder();
  let streamClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send: SendFn = (message, type = 'info') => {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ message, type, timestamp: new Date().toISOString() })}\n\n`));
        } catch { streamClosed = true; }
      };

      const sendDone: SendDoneFn = (extra = {}) => {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            message: 'DONE', type: 'success', timestamp: new Date().toISOString(), ...extra,
          })}\n\n`));
        } catch { streamClosed = true; }
      };

      const heartbeat = setInterval(() => {
        if (streamClosed) { clearInterval(heartbeat); return; }
        send('', 'keepalive');
      }, 10000);

      try {
        const { data: shop, error: shopError } = await supabase
          .from('shops').select('*').eq('id', shopId).single();

        if (shopError || !shop) {
          send('❌ Boutique non trouvée', 'error');
          sendDone();
          return;
        }

        if (phase === 'products') {
          await phaseProducts(shopId, shop, productType, send, sendDone);
        } else if (phase === 'costs') {
          await phaseCosts(shopId, shop, productType, offset, send, sendDone);
        } else if (phase === 'levels') {
          await phaseLevels(shopId, shop, productType, offset, send, sendDone);
        } else {
          send(`❌ Phase inconnue: ${phase}`, 'error');
          sendDone();
        }
      } catch (error) {
        send(`❌ Erreur: ${error}`, 'error');
        sendDone();
      } finally {
        clearInterval(heartbeat);
        streamClosed = true;
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

// ─── Phase 1: Products ────────────────────────────────────────────

async function phaseProducts(
  shopId: string, shop: any, productType: string | null,
  send: SendFn, sendDone: SendDoneFn
) {
  const label = productType ? ` (${productType})` : '';
  send(`🚀 Synchronisation${label}...`, 'info');
  send('', 'info');
  send(`✓ Boutique: ${shop.name || shop.shopify_url}`, 'success');
  send(`📦 Récupération des produits${label}...`, 'info');

  // Fetch all products from Shopify
  let allProducts: any[] = [];
  let baseUrl = `https://${shop.shopify_url}/admin/api/2024-01/products.json?limit=250`;
  if (productType) baseUrl += `&product_type=${encodeURIComponent(productType)}`;
  let currentUrl = baseUrl;
  let hasMorePages = true;
  let pageNum = 1;

  while (hasMorePages) {
    const response = await fetch(currentUrl, {
      headers: { 'X-Shopify-Access-Token': shop.shopify_token, 'Content-Type': 'application/json' },
    });
    if (!response.ok) { send(`❌ Erreur API Shopify (page ${pageNum})`, 'error'); break; }

    const data = await response.json();
    const products = data.products || [];
    allProducts = allProducts.concat(products);
    send(`  └─ Page ${pageNum}: ${products.length} produits`, 'progress');
    pageNum++;

    const linkHeader = response.headers.get('Link');
    hasMorePages = false;
    if (linkHeader) {
      const m = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (m?.[1]) { currentUrl = m[1]; hasMorePages = true; }
    }
  }

  // Log des statuts pour debug
  const statusCounts: Record<string, number> = {};
  for (const p of allProducts) {
    statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
  }
  const statusSummary = Object.entries(statusCounts).map(([s, c]) => `${s}: ${c}`).join(', ');
  send(`✓ ${allProducts.length} produits récupérés (${statusSummary})`, 'success');

  // Exclure brouillons, archivés, et produits taggés no-ivy
  allProducts = allProducts.filter(p =>
    p.status !== 'draft' && p.status !== 'archived' &&
    !(p.tags && (p.tags as string).split(',').map((t: string) => t.trim().toLowerCase()).includes('no-ivy'))
  );

  // Upsert products
  send('', 'info');
  send('💾 Sauvegarde des produits...', 'info');

  const productsToUpsert = allProducts.map((p: any) => ({
    shop_id: shopId,
    shopify_id: p.id.toString(),
    title: p.title,
    handle: p.handle,
    image_url: p.image?.src || p.images?.[0]?.src || null,
    status: (p.status === 'draft' || p.status === 'archived') ? p.status : 'active',
    product_type: p.product_type || null,
    option1_name: p.options?.[0]?.name || null,
    option2_name: p.options?.[1]?.name || null,
    option3_name: p.options?.[2]?.name || null,
    synced_at: new Date().toISOString(),
  }));

  if (productsToUpsert.length > 0) {
    const { error } = await supabase
      .from('products')
      .upsert(productsToUpsert, { onConflict: 'shop_id,shopify_id' });
    if (error) send(`❌ Erreur sauvegarde produits: ${error.message}`, 'error');
  }

  // Build product ID map
  const { data: dbProducts } = await supabase
    .from('products').select('id, shopify_id').eq('shop_id', shopId);
  const productIdMap: Record<string, string> = {};
  dbProducts?.forEach((p: any) => { productIdMap[p.shopify_id] = p.id; });

  send(`✓ ${productsToUpsert.length} produits sauvegardés`, 'success');

  // Mark absent products as local
  const activeIds = allProducts.map((p: any) => p.id.toString());
  if (activeIds.length > 0) {
    let q = supabase.from('products').update({ status: 'local' })
      .eq('shop_id', shopId).in('status', ['active', 'draft']);
    if (productType) q = q.eq('product_type', productType);

    const { data: localRows } = await q
      .not('shopify_id', 'in', `(${activeIds.join(',')})`)
      .select('id, title');

    if (localRows && localRows.length > 0) {
      await supabase.from('product_variants')
        .update({ shopify_active: false })
        .in('product_id', localRows.map(p => p.id));

      send(`📌 ${localRows.length} produit${localRows.length > 1 ? 's' : ''} passé${localRows.length > 1 ? 's' : ''} en local`, 'info');
      for (const p of localRows.slice(0, 5)) send(`   └─ ${p.title}`, 'info');
      if (localRows.length > 5) send(`   └─ ... et ${localRows.length - 5} autres`, 'info');
    }
  }

  // Backfill local variants
  send('🔧 Vérification des produits locaux...', 'info');
  const { data: alreadyLocal } = await supabase
    .from('products').select('id').eq('shop_id', shopId).eq('status', 'local');

  if (alreadyLocal && alreadyLocal.length > 0) {
    const { data: fixed } = await supabase.from('product_variants')
      .update({ shopify_active: false })
      .in('product_id', alreadyLocal.map(p => p.id))
      .eq('shopify_active', true)
      .select('id');
    if (fixed && fixed.length > 0) {
      send(`🔧 ${fixed.length} variante(s) de produits locaux corrigée(s)`, 'info');
    }
  }

  // Upsert variants (costs will be updated in phase 'costs')
  send('', 'info');
  send('📋 Sauvegarde des variantes...', 'info');

  const variantsToUpsert: any[] = [];
  for (const product of allProducts) {
    const productId = productIdMap[product.id.toString()];
    if (!productId) continue;
    for (const v of product.variants || []) {
      variantsToUpsert.push({
        product_id: productId,
        shopify_id: v.id.toString(),
        title: v.title,
        sku: v.sku,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
        inventory_item_id: v.inventory_item_id?.toString(),
        price: v.price ? parseFloat(v.price) : 0,
        shopify_active: true,
      });
    }
  }

  const variantBatches = Math.ceil(variantsToUpsert.length / 500);
  for (let i = 0; i < variantsToUpsert.length; i += 500) {
    const batchNum = Math.floor(i / 500) + 1;
    const batch = variantsToUpsert.slice(i, i + 500);
    send(`  └─ Batch ${batchNum}/${variantBatches} (${batch.length} variantes)...`, 'progress');
    const { error } = await supabase
      .from('product_variants')
      .upsert(batch, { onConflict: 'product_id,shopify_id' });
    if (error) send(`    ❌ Erreur: ${error.message}`, 'error');
  }

  send(`✓ ${variantsToUpsert.length} variantes sauvegardées`, 'success');

  // Mark absent variants as local
  const byProduct: Record<string, string[]> = {};
  for (const v of variantsToUpsert) {
    if (!byProduct[v.product_id]) byProduct[v.product_id] = [];
    byProduct[v.product_id].push(v.shopify_id);
  }

  send('🔍 Vérification des variantes locales...', 'info');
  const syncedProductIds = Object.keys(byProduct);

  // Build O(1) lookup set per product
  const keepByProduct = new Map<string, Set<string>>();
  for (const pid of syncedProductIds) {
    keepByProduct.set(pid, new Set(byProduct[pid]));
  }

  // Load all currently-active variants for synced products (paginated to bypass 1000-row limit)
  const activeVariants: { id: string; product_id: string; shopify_id: string }[] = [];
  for (let i = 0; i < syncedProductIds.length; i += 50) {
    const batch = syncedProductIds.slice(i, i + 50);
    let from = 0;
    while (true) {
      const { data } = await supabase
        .from('product_variants')
        .select('id, product_id, shopify_id')
        .in('product_id', batch)
        .eq('shopify_active', true)
        .range(from, from + 999);
      if (data && data.length > 0) {
        activeVariants.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      } else break;
    }
  }

  // Compute variant IDs absent from this sync
  const toDeactivate = activeVariants
    .filter(v => {
      const keep = keepByProduct.get(v.product_id);
      return !keep || !keep.has(v.shopify_id);
    })
    .map(v => v.id);

  // Single bulk update (chunked to avoid PostgREST URL length limits)
  if (toDeactivate.length > 0) {
    for (let i = 0; i < toDeactivate.length; i += 500) {
      const batch = toDeactivate.slice(i, i + 500);
      const { error } = await supabase
        .from('product_variants')
        .update({ shopify_active: false })
        .in('id', batch);
      if (error) {
        send(`    ❌ Erreur désactivation: ${error.message}`, 'error');
        break;
      }
    }
  }
  const localVariantsCount = toDeactivate.length;

  if (localVariantsCount > 0) {
    send(`📌 ${localVariantsCount} variante${localVariantsCount > 1 ? 's' : ''} marquée${localVariantsCount > 1 ? 's' : ''} comme locale${localVariantsCount > 1 ? 's' : ''}`, 'info');
  }

  // Deduplicate local variants
  await deduplicateLocalVariants(supabase, syncedProductIds, send);

  sendDone({ nextPhase: 'costs', nextOffset: 0 });
}

// ─── Phase 2: Costs ───────────────────────────────────────────────

async function phaseCosts(
  shopId: string, shop: any, productType: string | null, offset: number,
  send: SendFn, sendDone: SendDoneFn
) {
  if (offset === 0) {
    send('', 'info');
    send('💰 Récupération des coûts depuis Shopify...', 'info');
  }

  const { inventoryItemIds, inventoryItemToVariantUuid } = await loadActiveVariants(shopId, productType);

  if (inventoryItemIds.length === 0) {
    send('  └─ Aucun inventory item à traiter', 'info');
    sendDone({ nextPhase: 'levels', nextOffset: 0 });
    return;
  }

  const totalBatches = Math.ceil(inventoryItemIds.length / 50);
  const startBatch = offset;
  const endBatch = Math.min(startBatch + MAX_BATCHES_PER_CHUNK, totalBatches);

  send(`  └─ Batches ${startBatch + 1}–${endBatch} sur ${totalBatches}`, 'progress');

  let itemsWithCost = 0;
  let itemsWithoutCost = 0;

  for (let batchIdx = startBatch; batchIdx < endBatch; batchIdx++) {
    const start = batchIdx * 50;
    const batch = inventoryItemIds.slice(start, start + 50);
    send(`  └─ Batch ${batchIdx + 1}/${totalBatches} (${batch.length} items)...`, 'progress');

    const data = await shopifyFetchRetry(
      `https://${shop.shopify_url}/admin/api/2024-01/inventory_items.json?ids=${batch.join(',')}`,
      shop.shopify_token, send, `Batch ${batchIdx + 1}`
    );

    if (data) {
      const items = data.inventory_items || [];
      // Update costs concurrently in DB
      const updates = items.map((item: any) => {
        const cost = item.cost ? parseFloat(item.cost) : 0;
        if (cost > 0) itemsWithCost++; else itemsWithoutCost++;
        const variantUuid = inventoryItemToVariantUuid[item.id.toString()];
        if (!variantUuid) return null;
        return supabase.from('product_variants').update({ cost }).eq('id', variantUuid);
      }).filter(Boolean);
      await Promise.all(updates);

      if (items.length < batch.length) {
        send(`    ⚠️ Reçu ${items.length}/${batch.length} items`, 'warning');
      }
    }
  }

  send(`  └─ Chunk: ${itemsWithCost} avec coût, ${itemsWithoutCost} sans coût`, 'progress');

  if (endBatch < totalBatches) {
    sendDone({ nextPhase: 'costs', nextOffset: endBatch });
  } else {
    send(`✓ Coûts mis à jour`, 'success');
    sendDone({ nextPhase: 'levels', nextOffset: 0 });
  }
}

// ─── Phase 3: Levels + Metafields ─────────────────────────────────

async function phaseLevels(
  shopId: string, shop: any, productType: string | null, offset: number,
  send: SendFn, sendDone: SendDoneFn
) {
  const { inventoryItemIds, inventoryItemToVariantUuid, variantIdMap } =
    await loadActiveVariants(shopId, productType);

  // Sync metafields only on first chunk
  if (offset === 0) {
    send('', 'info');
    send('🏷️ Synchronisation des métachamps...', 'info');
    try {
      const count = await syncVariantMetafields(
        supabase, shopId, shop.shopify_url, shop.shopify_token, variantIdMap, send
      );
      if (count > 0) send(`✓ ${count} métachamp(s) synchronisé(s)`, 'success');
    } catch (err: unknown) {
      send(`❌ Erreur métachamps: ${err instanceof Error ? err.message : err}`, 'error');
    }
    send('', 'info');
    send('📊 Mise à jour des niveaux d\'inventaire...', 'info');
  }

  if (inventoryItemIds.length === 0) {
    send('  └─ Aucun inventory item', 'info');
    send('', 'info');
    send('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    send('✅ Synchronisation terminée!', 'success');
    sendDone({ nextPhase: null });
    return;
  }

  const totalBatches = Math.ceil(inventoryItemIds.length / 50);
  const startBatch = offset;
  const endBatch = Math.min(startBatch + MAX_BATCHES_PER_CHUNK, totalBatches);

  send(`  └─ Batches ${startBatch + 1}–${endBatch} sur ${totalBatches}`, 'progress');

  const inventoryToUpsert: any[] = [];

  for (let batchIdx = startBatch; batchIdx < endBatch; batchIdx++) {
    const start = batchIdx * 50;
    const batch = inventoryItemIds.slice(start, start + 50);
    send(`  └─ Batch ${batchIdx + 1}/${totalBatches} (${batch.length} items)...`, 'progress');

    const data = await shopifyFetchRetry(
      `https://${shop.shopify_url}/admin/api/2024-01/inventory_levels.json?inventory_item_ids=${batch.join(',')}&limit=250`,
      shop.shopify_token, send, `Batch ${batchIdx + 1}`
    );

    if (data) {
      for (const level of data.inventory_levels || []) {
        const variantUuid = inventoryItemToVariantUuid[level.inventory_item_id.toString()];
        if (variantUuid) {
          inventoryToUpsert.push({
            variant_id: variantUuid,
            location_id: level.location_id.toString(),
            quantity: level.available || 0,
            synced_at: new Date().toISOString(),
          });
        }
      }
    }
  }

  // Upsert inventory levels
  if (inventoryToUpsert.length > 0) {
    send(`  └─ Sauvegarde de ${inventoryToUpsert.length} niveaux...`, 'progress');
    for (let i = 0; i < inventoryToUpsert.length; i += 500) {
      const batch = inventoryToUpsert.slice(i, i + 500);
      await supabase.from('inventory_levels').upsert(batch, { onConflict: 'variant_id,location_id' });
    }
  }

  if (endBatch < totalBatches) {
    send(`  └─ ${inventoryToUpsert.length} niveaux sauvegardés (chunk)`, 'progress');
    sendDone({ nextPhase: 'levels', nextOffset: endBatch });
  } else {
    send(`✓ ${inventoryToUpsert.length} niveaux d'inventaire mis à jour`, 'success');
    send('', 'info');
    send('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    send('✅ Synchronisation terminée!', 'success');
    sendDone({ nextPhase: null });
  }
}
