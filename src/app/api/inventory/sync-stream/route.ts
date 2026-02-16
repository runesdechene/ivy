import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { syncVariantMetafields, deduplicateLocalVariants } from '@/lib/shopify-metafields';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get('shopId');
  const locationId = searchParams.get('locationId');
  const productType = searchParams.get('productType'); // Filtre optionnel par type de produit

  if (!shopId) {
    return new Response('Missing shopId', { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      
      const send = (message: string, type: string = 'info') => {
        const data = JSON.stringify({ message, type, timestamp: new Date().toISOString() });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      try {
        if (productType) {
          send(`🚀 Synchronisation: ${productType}`, 'info');
        } else {
          send('🚀 Démarrage de la synchronisation...', 'info');
        }
        send('', 'info');

        // Récupérer la boutique
        const { data: shop, error: shopError } = await supabase
          .from('shops')
          .select('*')
          .eq('id', shopId)
          .single();

        if (shopError || !shop) {
          send('❌ Boutique non trouvée', 'error');
          controller.close();
          return;
        }

        send(`✓ Boutique: ${shop.name || shop.shopify_url}`, 'success');

        // Récupérer les produits depuis Shopify (API REST)
        const productTypeLabel = productType ? ` (${productType})` : '';
        send(`📦 Récupération des produits${productTypeLabel}...`, 'info');
        
        let allProducts: any[] = [];
        // Ajouter le filtre product_type si spécifié
        let baseUrl = `https://${shop.shopify_url}/admin/api/2024-01/products.json?status=active&limit=250`;
        if (productType) {
          baseUrl += `&product_type=${encodeURIComponent(productType)}`;
        }
        let currentUrl = baseUrl;
        let hasMorePages = true;
        let pageNum = 1;

        while (hasMorePages) {
          const response = await fetch(currentUrl, {
            headers: {
              'X-Shopify-Access-Token': shop.shopify_token,
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            send(`❌ Erreur API Shopify (page ${pageNum})`, 'error');
            break;
          }

          const data = await response.json();
          const products = data.products || [];
          allProducts = allProducts.concat(products);
          
          send(`  └─ Page ${pageNum}: ${products.length} produits`, 'progress');
          pageNum++;

          // Vérifier s'il y a une page suivante (Link header)
          const linkHeader = response.headers.get('Link');
          hasMorePages = false;
          if (linkHeader) {
            const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
            if (nextMatch && nextMatch[1]) {
              currentUrl = nextMatch[1];
              hasMorePages = true;
            }
          }
        }

        send(`✓ ${allProducts.length} produits récupérés`, 'success');

        // Upsert des produits
        send('', 'info');
        send('💾 Sauvegarde des produits...', 'info');

        const productsToUpsert = allProducts.map((product: any) => ({
          shop_id: shopId,
          shopify_id: product.id.toString(),
          title: product.title,
          handle: product.handle,
          image_url: product.image?.src || product.images?.[0]?.src || null,
          status: product.status,
          product_type: product.product_type || null,
          option1_name: product.options?.[0]?.name || null,
          option2_name: product.options?.[1]?.name || null,
          option3_name: product.options?.[2]?.name || null,
          synced_at: new Date().toISOString(),
        }));

        if (productsToUpsert.length > 0) {
          const { error: productsError } = await supabase
            .from('products')
            .upsert(productsToUpsert, { onConflict: 'shop_id,shopify_id' });
          
          if (productsError) {
            send(`❌ Erreur sauvegarde produits: ${productsError.message}`, 'error');
          }
        }

        // Récupérer les IDs des produits pour les variantes
        const { data: dbProducts } = await supabase
          .from('products')
          .select('id, shopify_id')
          .eq('shop_id', shopId);

        const productIdMap: Record<string, string> = {};
        dbProducts?.forEach((p: any) => {
          productIdMap[p.shopify_id] = p.id;
        });

        send(`✓ ${productsToUpsert.length} produits sauvegardés`, 'success');

        // Marquer les produits absents de Shopify comme locaux
        // (brouillons, supprimés ou désactivés côté Shopify)
        const activeShopifyProductIds = allProducts.map((p: any) => p.id.toString());
        if (activeShopifyProductIds.length > 0) {
          let query = supabase
            .from('products')
            .update({ status: 'local' })
            .eq('shop_id', shopId)
            .in('status', ['active', 'draft']);

          // Si sync par type, ne marquer que les produits de ce type
          if (productType) {
            query = query.eq('product_type', productType);
          }

          const { data: localRows } = await query
            .not('shopify_id', 'in', `(${activeShopifyProductIds.join(',')})`)
            .select('id, title');

          if (localRows && localRows.length > 0) {
            // Passer toutes les variantes de ces produits en locale
            const localProductIds = localRows.map(p => p.id);
            await supabase
              .from('product_variants')
              .update({ shopify_active: false })
              .in('product_id', localProductIds);

            send(`📌 ${localRows.length} produit${localRows.length > 1 ? 's' : ''} passé${localRows.length > 1 ? 's' : ''} en local (plus actif${localRows.length > 1 ? 's' : ''} sur Shopify)`, 'info');
            for (const p of localRows.slice(0, 5)) {
              send(`   └─ ${p.title}`, 'info');
            }
            if (localRows.length > 5) {
              send(`   └─ ... et ${localRows.length - 5} autres`, 'info');
            }
          }
        }

        // 1. D'abord collecter tous les inventory_item_ids
        send('', 'info');
        send('📋 Préparation des variantes...', 'info');

        const inventoryItemIds: number[] = [];
        const inventoryItemToVariantIndex: Record<string, number[]> = {};
        
        let variantIndex = 0;
        for (const product of allProducts) {
          const productId = productIdMap[product.id.toString()];
          if (!productId) continue;

          for (const variant of product.variants || []) {
            if (variant.inventory_item_id) {
              inventoryItemIds.push(variant.inventory_item_id);
              const key = variant.inventory_item_id.toString();
              if (!inventoryItemToVariantIndex[key]) {
                inventoryItemToVariantIndex[key] = [];
              }
              inventoryItemToVariantIndex[key].push(variantIndex);
            }
            variantIndex++;
          }
        }

        send(`  └─ ${inventoryItemIds.length} inventory items à récupérer`, 'progress');

        // 2. Récupérer TOUS les coûts depuis inventory_items AVANT l'upsert
        send('', 'info');
        send('💰 Récupération des coûts depuis Shopify...', 'info');

        const inventoryItemToCost: Record<string, number> = {};
        let itemsWithCost = 0;
        let itemsWithoutCost = 0;
        const totalBatches = Math.ceil(inventoryItemIds.length / 50);
        
        for (let i = 0; i < inventoryItemIds.length; i += 50) {
          const batchNum = Math.floor(i / 50) + 1;
          const batch = inventoryItemIds.slice(i, i + 50);
          
          send(`  └─ Batch ${batchNum}/${totalBatches} (${batch.length} items)...`, 'progress');
          
          // Retry avec backoff exponentiel pour gérer le rate limiting (429)
          let retries = 0;
          const maxRetries = 3;
          let success = false;
          
          while (!success && retries <= maxRetries) {
            // Attendre avant chaque requête (plus longtemps après un retry)
            const delay = retries === 0 ? 500 : 1000 * Math.pow(2, retries);
            await new Promise(resolve => setTimeout(resolve, delay));
            
            const inventoryResponse = await fetch(
              `https://${shop.shopify_url}/admin/api/2024-01/inventory_items.json?ids=${batch.join(',')}`,
              {
                headers: {
                  'X-Shopify-Access-Token': shop.shopify_token,
                  'Content-Type': 'application/json',
                },
              }
            );

            if (inventoryResponse.ok) {
              const inventoryData = await inventoryResponse.json();
              const items = inventoryData.inventory_items || [];
              
              for (const item of items) {
                const cost = item.cost ? parseFloat(item.cost) : 0;
                inventoryItemToCost[item.id.toString()] = cost;
                if (cost > 0) {
                  itemsWithCost++;
                } else {
                  itemsWithoutCost++;
                }
              }
              
              if (items.length < batch.length) {
                send(`    ⚠️ Reçu ${items.length}/${batch.length} items`, 'warning');
              }
              success = true;
            } else if (inventoryResponse.status === 429) {
              retries++;
              if (retries <= maxRetries) {
                send(`    ⏳ Rate limit, retry ${retries}/${maxRetries}...`, 'warning');
              } else {
                send(`    ❌ Batch ${batchNum}: rate limit après ${maxRetries} retries`, 'error');
              }
            } else {
              send(`    ❌ Erreur batch ${batchNum}: ${inventoryResponse.status}`, 'error');
              break;
            }
          }
        }

        send(`  └─ Total: ${itemsWithCost} avec coût, ${itemsWithoutCost} sans coût`, 'progress');

        // 3. Maintenant créer les variantes AVEC les coûts
        send('', 'info');
        send('📋 Sauvegarde des variantes avec coûts...', 'info');

        const variantsToUpsert: any[] = [];
        const inventoryItemToVariantShopifyId: Record<string, string> = {};

        for (const product of allProducts) {
          const productId = productIdMap[product.id.toString()];
          if (!productId) continue;

          for (const variant of product.variants || []) {
            // Récupérer le coût depuis notre map
            const inventoryItemId = variant.inventory_item_id?.toString();
            const cost = inventoryItemId ? (inventoryItemToCost[inventoryItemId] ?? 0) : 0;
            const price = variant.price ? parseFloat(variant.price) : 0;

            variantsToUpsert.push({
              product_id: productId,
              shopify_id: variant.id.toString(),
              title: variant.title,
              sku: variant.sku,
              option1: variant.option1,
              option2: variant.option2,
              option3: variant.option3,
              inventory_item_id: inventoryItemId,
              cost: cost,
              price: price,
              shopify_active: true,
            });

            if (variant.inventory_item_id) {
              inventoryItemToVariantShopifyId[variant.inventory_item_id.toString()] = variant.id.toString();
            }
          }
        }

        // Upsert par batch
        const variantBatches = Math.ceil(variantsToUpsert.length / 500);
        for (let i = 0; i < variantsToUpsert.length; i += 500) {
          const batchNum = Math.floor(i / 500) + 1;
          const batch = variantsToUpsert.slice(i, i + 500);
          send(`  └─ Batch ${batchNum}/${variantBatches} (${batch.length} variantes)...`, 'progress');
          
          const { error } = await supabase
            .from('product_variants')
            .upsert(batch, { onConflict: 'product_id,shopify_id' });
          
          if (error) {
            send(`    ❌ Erreur: ${error.message}`, 'error');
          }
        }

        send(`✓ ${variantsToUpsert.length} variantes sauvegardées avec coûts`, 'success');

        // Marquer les variantes absentes de Shopify comme locales (shopify_active = false)
        const shopifyVariantIdsByProduct: Record<string, string[]> = {};
        for (const v of variantsToUpsert) {
          if (!shopifyVariantIdsByProduct[v.product_id]) {
            shopifyVariantIdsByProduct[v.product_id] = [];
          }
          shopifyVariantIdsByProduct[v.product_id].push(v.shopify_id);
        }

        let localVariantsCount = 0;
        const syncedProductIds = Object.keys(shopifyVariantIdsByProduct);
        for (const productId of syncedProductIds) {
          const activeShopifyIds = shopifyVariantIdsByProduct[productId];
          const { data: markedRows } = await supabase
            .from('product_variants')
            .update({ shopify_active: false })
            .eq('product_id', productId)
            .eq('shopify_active', true)
            .not('shopify_id', 'in', `(${activeShopifyIds.join(',')})`)
            .select('id');

          if (markedRows) {
            localVariantsCount += markedRows.length;
          }
        }

        if (localVariantsCount > 0) {
          send(`📌 ${localVariantsCount} variante${localVariantsCount > 1 ? 's' : ''} marquée${localVariantsCount > 1 ? 's' : ''} comme locale${localVariantsCount > 1 ? 's' : ''}`, 'info');
        }

        // Supprimer les variantes locales dupliquées (même options qu'une variante Shopify active)
        const dedupCount = await deduplicateLocalVariants(supabase, syncedProductIds, send);

        // Récupérer les IDs des variantes pour l'inventaire (pagination .range() car Supabase plafonne à 1000 rows)
        const allDbVariants: any[] = [];
        const productUuids = Object.values(productIdMap);
        for (let i = 0; i < productUuids.length; i += 50) {
          const pBatch = productUuids.slice(i, i + 50);
          let from = 0;
          while (true) {
            const { data } = await supabase
              .from('product_variants')
              .select('id, shopify_id, inventory_item_id')
              .in('product_id', pBatch)
              .range(from, from + 999);
            if (data && data.length > 0) {
              allDbVariants.push(...data);
              if (data.length < 1000) break;
              from += 1000;
            } else {
              break;
            }
          }
        }

        const variantIdMap: Record<string, string> = {};
        const inventoryItemToVariantUuid: Record<string, string> = {};
        allDbVariants.forEach((v: any) => {
          variantIdMap[v.shopify_id] = v.id;
          if (v.inventory_item_id) {
            inventoryItemToVariantUuid[v.inventory_item_id] = v.id;
          }
        });

        send(`📦 ${allDbVariants.length} variantes chargées pour sync métachamps + inventaire`, 'info');

        // Synchroniser les métachamps des variantes depuis Shopify
        const metafieldCount = await syncVariantMetafields(
          supabase, shopId!, shop.shopify_url, shop.shopify_token, variantIdMap, send
        );

        // Récupérer les niveaux d'inventaire
        send('', 'info');
        send('📊 Mise à jour des niveaux d\'inventaire...', 'info');

        const inventoryToUpsert: any[] = [];
        const totalLevelBatches = Math.ceil(inventoryItemIds.length / 50);
        
        for (let i = 0; i < inventoryItemIds.length; i += 50) {
          const batchNum = Math.floor(i / 50) + 1;
          const batch = inventoryItemIds.slice(i, i + 50);
          
          send(`  └─ Batch ${batchNum}/${totalLevelBatches} (${batch.length} items)...`, 'progress');
          
          // Retry avec backoff exponentiel pour gérer le rate limiting (429)
          let retries = 0;
          const maxRetries = 3;
          let success = false;
          
          while (!success && retries <= maxRetries) {
            const delay = retries === 0 ? 500 : 1000 * Math.pow(2, retries);
            await new Promise(resolve => setTimeout(resolve, delay));
            
            const levelsResponse = await fetch(
              `https://${shop.shopify_url}/admin/api/2024-01/inventory_levels.json?inventory_item_ids=${batch.join(',')}&limit=250`,
              {
                headers: {
                  'X-Shopify-Access-Token': shop.shopify_token,
                  'Content-Type': 'application/json',
                },
              }
            );

            if (levelsResponse.ok) {
              const levelsData = await levelsResponse.json();
              for (const level of levelsData.inventory_levels || []) {
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
              success = true;
            } else if (levelsResponse.status === 429) {
              retries++;
              if (retries <= maxRetries) {
                send(`    ⏳ Rate limit, retry ${retries}/${maxRetries}...`, 'warning');
              } else {
                send(`    ❌ Batch ${batchNum}: rate limit après ${maxRetries} retries`, 'error');
              }
            } else {
              send(`    ❌ Erreur batch ${batchNum}: ${levelsResponse.status}`, 'error');
              break;
            }
          }
        }

        // Upsert inventaire par batch
        send(`  └─ Sauvegarde de ${inventoryToUpsert.length} niveaux...`, 'progress');
        for (let i = 0; i < inventoryToUpsert.length; i += 500) {
          const batch = inventoryToUpsert.slice(i, i + 500);
          await supabase
            .from('inventory_levels')
            .upsert(batch, { onConflict: 'variant_id,location_id' });
        }

        send(`✓ ${inventoryToUpsert.length} niveaux d'inventaire mis à jour`, 'success');

        send('', 'info');
        send('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
        send(`✅ Synchronisation terminée!`, 'success');
        send(`   ${allProducts.length} produits, ${variantsToUpsert.length} variantes, ${metafieldCount} métachamp(s)${dedupCount > 0 ? `, ${dedupCount} doublon(s) supprimé(s)` : ''}`, 'info');
        send('DONE', 'success');

      } catch (error) {
        send(`❌ Erreur: ${error}`, 'error');
      } finally {
        controller.close();
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
