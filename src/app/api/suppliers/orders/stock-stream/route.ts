import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// --- Helpers (duplicated from parent route for isolation) ---

async function batchMarkStatus(itemIds: string[], status: 'added' | 'failed', error: string | null) {
  const updateData: Record<string, any> = {
    stock_status: status,
    stock_error: error,
  };
  if (status === 'added') {
    updateData.stock_added_at = new Date().toISOString();
    updateData.stock_error = null;
  }
  await supabase
    .from('supplier_order_items')
    .update(updateData)
    .in('id', itemIds);
}

async function createVariantOnShopify(
  shop: { shopify_url: string; shopify_token: string },
  shopifyProductId: string,
  variant: { id: string; option1: string | null; option2: string | null; option3: string | null; sku: string | null; price: number }
): Promise<{ shopifyVariantId: string; inventoryItemId: string }> {
  const variantBody: Record<string, any> = {
    inventory_management: 'shopify',
  };
  if (variant.option1) variantBody.option1 = variant.option1;
  if (variant.option2) variantBody.option2 = variant.option2;
  if (variant.option3) variantBody.option3 = variant.option3;
  if (variant.sku) variantBody.sku = variant.sku;
  if (variant.price) variantBody.price = String(variant.price);

  const response = await fetch(
    `https://${shop.shopify_url}/admin/api/2024-01/products/${shopifyProductId}/variants.json`,
    {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': shop.shopify_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ variant: variantBody }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.errors ? JSON.stringify(errorData.errors) : `HTTP ${response.status}`);
  }

  const data = await response.json();
  const created = data.variant;

  await supabase
    .from('product_variants')
    .update({
      shopify_id: String(created.id),
      inventory_item_id: String(created.inventory_item_id),
      shopify_active: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', variant.id);

  return {
    shopifyVariantId: String(created.id),
    inventoryItemId: String(created.inventory_item_id),
  };
}

// --- Streaming endpoint ---

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get('orderId');
  const shopId = searchParams.get('shopId');
  const locationId = searchParams.get('locationId');
  const retryOnly = searchParams.get('retryOnly') === 'true';

  if (!orderId || !shopId) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
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

      const result = { added: 0, failed: 0, skipped: 0, errors: [] as any[] };

      try {
        // 1. Update order status to completed (if not retry)
        if (!retryOnly) {
          send('📋 Passage de la commande en "Terminée"...', 'info');
          const { error: updateError } = await supabase
            .from('supplier_orders')
            .update({
              status: 'completed',
              closed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', orderId)
            .eq('shop_id', shopId);

          if (updateError) {
            send(`❌ Erreur mise à jour commande: ${updateError.message}`, 'error');
            sendDone({ stockResult: result });
            clearInterval(heartbeat);
            controller.close();
            return;
          }
          send('✓ Commande marquée comme terminée', 'success');
        } else {
          send('🔄 Retry des articles échoués...', 'info');
        }

        // 2. Count already added
        const { count: alreadyAddedCount } = await supabase
          .from('supplier_order_items')
          .select('*', { count: 'exact', head: true })
          .eq('order_id', orderId)
          .eq('is_validated', true)
          .eq('stock_status', 'added');

        result.skipped = alreadyAddedCount || 0;
        if (result.skipped > 0) {
          send(`⏭️  ${result.skipped} article(s) déjà ajouté(s) au stock`, 'info');
        }

        // 3. Get items to process
        let query = supabase
          .from('supplier_order_items')
          .select('id, variant_id, quantity, sku, variant_title')
          .eq('order_id', orderId)
          .eq('is_validated', true);

        if (retryOnly) {
          query = query.eq('stock_status', 'failed');
        } else {
          query = query.or('stock_status.is.null,stock_status.eq.failed');
        }

        const { data: validatedItems } = await query;

        if (!validatedItems || validatedItems.length === 0) {
          send('ℹ️  Aucun article à traiter', 'info');
          sendDone({ stockResult: result });
          clearInterval(heartbeat);
          controller.close();
          return;
        }

        send(`📦 ${validatedItems.length} article(s) à traiter...`, 'info');

        // 4. Group by variant_id
        const groups: Record<string, typeof validatedItems> = {};
        for (const item of validatedItems) {
          const key = item.variant_id || 'null';
          if (!groups[key]) groups[key] = [];
          groups[key].push(item);
        }

        send(`🔀 ${Object.keys(groups).length} groupe(s) de variantes`, 'info');
        send('', 'info');

        // 5. Get shop info
        const { data: shop } = await supabase
          .from('shops')
          .select('shopify_url, shopify_token')
          .eq('id', shopId)
          .single();

        if (!shop) {
          send('❌ Boutique introuvable', 'error');
          for (const groupItems of Object.values(groups)) {
            await batchMarkStatus(groupItems.map(i => i.id), 'failed', 'Shop non trouvé');
            result.failed += groupItems.length;
          }
          sendDone({ stockResult: result });
          clearInterval(heartbeat);
          controller.close();
          return;
        }

        // 6. Determine location
        let shopifyLocationId = locationId;
        if (!shopifyLocationId) {
          const { data: locations } = await supabase
            .from('locations')
            .select('shopify_id')
            .eq('shop_id', shopId)
            .eq('active', true)
            .limit(1);
          shopifyLocationId = locations?.[0]?.shopify_id;
        }

        if (!shopifyLocationId) {
          send('❌ Aucun emplacement trouvé pour le stock', 'error');
          for (const groupItems of Object.values(groups)) {
            await batchMarkStatus(groupItems.map(i => i.id), 'failed', 'Aucun emplacement trouvé');
            result.failed += groupItems.length;
          }
          sendDone({ stockResult: result });
          clearInterval(heartbeat);
          controller.close();
          return;
        }

        // 7. Process each variant group
        let groupIndex = 0;
        const totalGroups = Object.keys(groups).length;

        for (const [variantKey, groupItems] of Object.entries(groups)) {
          groupIndex++;
          const totalQuantity = groupItems.reduce((sum, i) => sum + i.quantity, 0);
          const itemIds = groupItems.map(i => i.id);
          const sample = groupItems[0];
          const label = `${sample.sku || '?'} — ${sample.variant_title || '?'}`;

          send(`[${groupIndex}/${totalGroups}] ${label} (×${totalQuantity})`, 'progress');

          // Case 1: variant_id is NULL (link broken by ON DELETE SET NULL)
          if (variantKey === 'null') {
            await batchMarkStatus(itemIds, 'failed', 'Lien cassé — ajouter manuellement');
            result.failed += groupItems.length;
            result.errors.push({ sku: sample.sku || '', variant_title: sample.variant_title || '', error: 'Lien cassé — ajouter manuellement' });
            send(`  ⚠️  Lien cassé — ajouter manuellement`, 'warning');
            continue;
          }

          // Load variant + product
          const { data: variant } = await supabase
            .from('product_variants')
            .select('id, shopify_id, shopify_active, inventory_item_id, option1, option2, option3, sku, price, product_id')
            .eq('id', variantKey)
            .single();

          if (!variant) {
            await batchMarkStatus(itemIds, 'failed', 'Variante introuvable en base');
            result.failed += groupItems.length;
            result.errors.push({ sku: sample.sku || '', variant_title: sample.variant_title || '', error: 'Variante introuvable en base' });
            send(`  ❌ Variante introuvable en base`, 'error');
            continue;
          }

          const { data: product } = await supabase
            .from('products')
            .select('id, shopify_id, status')
            .eq('id', variant.product_id)
            .single();

          if (!product) {
            await batchMarkStatus(itemIds, 'failed', 'Produit introuvable en base');
            result.failed += groupItems.length;
            result.errors.push({ sku: sample.sku || '', variant_title: sample.variant_title || '', error: 'Produit introuvable en base' });
            send(`  ❌ Produit introuvable en base`, 'error');
            continue;
          }

          let inventoryItemId = variant.inventory_item_id;
          const isShopifyReady = variant.shopify_active && inventoryItemId;

          // Priority 1: Variant already has Shopify credentials → Shopify flow
          // Priority 2: Variant not ready but product is on Shopify → auto-create variant
          // Priority 3: Truly local (no shopify_id on product) → IVY-only stock
          if (!isShopifyReady) {
            if (product.shopify_id && product.status !== 'local') {
              // Try to create variant on Shopify
              send(`  🔧 Création de la variante sur Shopify...`, 'warning');
              try {
                const created = await createVariantOnShopify(shop, product.shopify_id, variant);
                inventoryItemId = created.inventoryItemId;
                send(`  ✓ Variante créée (ID: ${created.shopifyVariantId})`, 'success');
              } catch (err: any) {
                // Shopify creation failed → force fallback to IVY-only stock
                inventoryItemId = null;
                send(`  ⚠️  Création Shopify échouée, ajout au stock IVY uniquement`, 'warning');
              }
            }

            // IVY-only stock (truly local OR Shopify creation failed)
            if (!inventoryItemId) {
              try {
                const { data: currentLevel } = await supabase
                  .from('inventory_levels')
                  .select('quantity')
                  .eq('variant_id', variant.id)
                  .eq('location_id', shopifyLocationId)
                  .single();

                const oldQty = currentLevel?.quantity || 0;
                const newQuantity = oldQty + totalQuantity;

                await supabase
                  .from('inventory_levels')
                  .upsert({
                    variant_id: variant.id,
                    location_id: shopifyLocationId,
                    quantity: newQuantity,
                    synced_at: new Date().toISOString(),
                  }, { onConflict: 'variant_id,location_id' });

                await batchMarkStatus(itemIds, 'added', null);
                result.added += groupItems.length;
                send(`  ✓ +${totalQuantity} au stock IVY (${oldQty} → ${newQuantity}) — produit local`, 'success');
              } catch (err: any) {
                await batchMarkStatus(itemIds, 'failed', `Erreur stock local: ${err.message}`);
                result.failed += groupItems.length;
                result.errors.push({ sku: sample.sku || '', variant_title: sample.variant_title || '', error: `Erreur stock local: ${err.message}` });
                send(`  ❌ Erreur stock local: ${err.message}`, 'error');
              }
              continue;
            }
          }

          // Adjust inventory (local DB + Shopify)
          try {
            const { data: currentLevel } = await supabase
              .from('inventory_levels')
              .select('quantity')
              .eq('variant_id', variant.id)
              .eq('location_id', shopifyLocationId)
              .single();

            const oldQty = currentLevel?.quantity || 0;
            const newQuantity = oldQty + totalQuantity;

            await supabase
              .from('inventory_levels')
              .upsert({
                variant_id: variant.id,
                location_id: shopifyLocationId,
                quantity: newQuantity,
                synced_at: new Date().toISOString(),
              }, { onConflict: 'variant_id,location_id' });

            const adjustResponse = await fetch(
              `https://${shop.shopify_url}/admin/api/2024-01/inventory_levels/adjust.json`,
              {
                method: 'POST',
                headers: {
                  'X-Shopify-Access-Token': shop.shopify_token,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  location_id: parseInt(shopifyLocationId),
                  inventory_item_id: parseInt(inventoryItemId),
                  available_adjustment: totalQuantity,
                }),
              }
            );

            if (adjustResponse.ok) {
              await batchMarkStatus(itemIds, 'added', null);
              result.added += groupItems.length;
              send(`  ✓ +${totalQuantity} au stock (${oldQty} → ${newQuantity})`, 'success');
            } else {
              const errorData = await adjustResponse.json();
              const errorMsg = typeof errorData.errors === 'string'
                ? errorData.errors
                : JSON.stringify(errorData.errors || errorData);
              await batchMarkStatus(itemIds, 'failed', `Shopify: ${errorMsg}`);
              result.failed += groupItems.length;
              result.errors.push({ sku: sample.sku || '', variant_title: sample.variant_title || '', error: `Shopify: ${errorMsg}` });
              send(`  ❌ Shopify: ${errorMsg}`, 'error');
            }
          } catch (err: any) {
            await batchMarkStatus(itemIds, 'failed', `Erreur: ${err.message}`);
            result.failed += groupItems.length;
            result.errors.push({ sku: sample.sku || '', variant_title: sample.variant_title || '', error: `Erreur: ${err.message}` });
            send(`  ❌ ${err.message}`, 'error');
          }
        }

        // Summary
        send('', 'info');
        send('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
        send(
          `✅ ${result.added} ajouté(s) | ❌ ${result.failed} échoué(s) | ⏭️  ${result.skipped} ignoré(s)`,
          result.failed > 0 ? 'warning' : 'success'
        );

        sendDone({ stockResult: result });
      } catch (error: any) {
        send(`❌ Erreur globale: ${error.message}`, 'error');
        sendDone({ stockResult: result });
      } finally {
        clearInterval(heartbeat);
        if (!streamClosed) {
          try { controller.close(); } catch {}
        }
      }
    },
    cancel() {
      streamClosed = true;
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
