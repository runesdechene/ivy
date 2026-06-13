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
  const shopifyProductId = searchParams.get('productId');
  const locationId = searchParams.get('locationId');

  if (!shopId || !shopifyProductId) {
    return new Response('Missing shopId or productId', { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (message: string, type: string = 'info') => {
        const data = JSON.stringify({ message, type, timestamp: new Date().toISOString() });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      const sendResult = (product: any) => {
        const data = JSON.stringify({ message: 'DONE', type: 'success', product });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      try {
        // Récupérer la boutique
        const { data: shop, error: shopError } = await supabase
          .from('shops')
          .select('shopify_url, shopify_token, name')
          .eq('id', shopId)
          .single();

        if (shopError || !shop) {
          send('Boutique non trouvée', 'error');
          return;
        }

        send(`Récupération depuis Shopify...`, 'info');

        // 1. Récupérer le produit depuis Shopify
        const productResponse = await fetch(
          `https://${shop.shopify_url}/admin/api/2024-01/products/${shopifyProductId}.json`,
          {
            headers: {
              'X-Shopify-Access-Token': shop.shopify_token,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!productResponse.ok) {
          if (productResponse.status === 404) {
            // Produit non trouvé sur Shopify → basculer en local
            send('Produit non trouvé sur Shopify', 'warning');
            send('Basculement en Local seulement...', 'info');

            // Récupérer le produit en DB
            const { data: dbProd } = await supabase
              .from('products')
              .select('id, shopify_id, title, handle, image_url, product_type, option1_name, option2_name, option3_name')
              .eq('shop_id', shopId)
              .eq('shopify_id', shopifyProductId)
              .single();

            if (dbProd) {
              await supabase
                .from('products')
                .update({ status: 'local' })
                .eq('id', dbProd.id);

              // Passer toutes les variantes en locale
              await supabase
                .from('product_variants')
                .update({ shopify_active: false })
                .eq('product_id', dbProd.id);

              // Construire le produit mis à jour pour le frontend
              const { data: dbVariants } = await supabase
                .from('product_variants')
                .select('id, shopify_id, title, sku, option1, option2, option3, cost, shopify_active, inventory_levels(quantity, location_id)')
                .eq('product_id', dbProd.id);

              const variants = (dbVariants || []).map((variant: any) => {
                const size = variant.option1;
                let quantity = 0;
                if (variant.inventory_levels && Array.isArray(variant.inventory_levels)) {
                  if (locationId) {
                    const level = variant.inventory_levels.find((l: any) => l.location_id === locationId);
                    quantity = level?.quantity || 0;
                  } else {
                    quantity = variant.inventory_levels.reduce((sum: number, l: any) => sum + (l.quantity || 0), 0);
                  }
                }
                return {
                  id: `gid://shopify/ProductVariant/${variant.shopify_id}`,
                  supabaseId: variant.id,
                  title: variant.title,
                  sku: variant.sku,
                  quantity,
                  size,
                  cost: variant.cost || 0,
                  shopifyActive: variant.shopify_active ?? true,
                  options: [
                    variant.option1 && { name: dbProd.option1_name || 'Option 1', value: variant.option1 },
                    variant.option2 && { name: dbProd.option2_name || 'Option 2', value: variant.option2 },
                    variant.option3 && { name: dbProd.option3_name || 'Option 3', value: variant.option3 },
                  ].filter(Boolean),
                };
              });

              const totalQuantity = variants.reduce((sum: number, v: any) => sum + v.quantity, 0);
              const sizeBreakdown: Record<string, number> = {};
              variants.forEach((v: any) => {
                if (v.size) sizeBreakdown[v.size] = (sizeBreakdown[v.size] || 0) + v.quantity;
              });
              const costs = variants.map((v: any) => v.cost || 0);
              const costRange = costs.length > 0
                ? { min: Math.min(...costs), max: Math.max(...costs) }
                : undefined;

              const updatedProduct = {
                id: `gid://shopify/Product/${shopifyProductId}`,
                supabaseId: dbProd.id,
                title: dbProd.title,
                handle: dbProd.handle,
                status: 'LOCAL',
                image: dbProd.image_url,
                imageAlt: dbProd.title,
                productType: dbProd.product_type || null,
                totalQuantity,
                sizeBreakdown,
                costRange,
                variants,
                syncedAt: new Date().toISOString(),
              };

              send('✅ Produit basculé en Local seulement', 'success');
              sendResult(updatedProduct);
            } else {
              send('Produit introuvable en base de données', 'error');
            }

            return;
          }

          send(`Erreur API Shopify: ${productResponse.status}`, 'error');
          return;
        }

        const { product: shopifyProduct } = await productResponse.json();
        send(`✓ ${shopifyProduct.title}`, 'success');

        // 2. Upsert le produit
        send('Sauvegarde du produit...', 'info');
        const { error: productUpsertError } = await supabase
          .from('products')
          .upsert({
            shop_id: shopId,
            shopify_id: shopifyProduct.id.toString(),
            title: shopifyProduct.title,
            handle: shopifyProduct.handle,
            image_url: shopifyProduct.image?.src || shopifyProduct.images?.[0]?.src || null,
            status: shopifyProduct.status,
            product_type: shopifyProduct.product_type || null,
            option1_name: shopifyProduct.options?.[0]?.name || null,
            option2_name: shopifyProduct.options?.[1]?.name || null,
            option3_name: shopifyProduct.options?.[2]?.name || null,
            synced_at: new Date().toISOString(),
          }, { onConflict: 'shop_id,shopify_id' });

        if (productUpsertError) {
          send(`Erreur sauvegarde: ${productUpsertError.message}`, 'error');
          return;
        }

        // Récupérer l'UUID du produit en DB
        const { data: dbProduct } = await supabase
          .from('products')
          .select('id')
          .eq('shop_id', shopId)
          .eq('shopify_id', shopifyProduct.id.toString())
          .single();

        if (!dbProduct) {
          send('Produit introuvable en DB après upsert', 'error');
          return;
        }

        const productUuid = dbProduct.id;

        // 3. Préparer et upsert les variantes
        send(`Sauvegarde des variantes...`, 'info');
        const inventoryItemIds: number[] = [];
        const inventoryItemToVariantShopifyId: Record<string, string> = {};
        const shopifyVariantIds: string[] = [];

        const variantsToUpsert = (shopifyProduct.variants || []).map((variant: any) => {
          const inventoryItemId = variant.inventory_item_id?.toString();
          if (variant.inventory_item_id) {
            inventoryItemIds.push(variant.inventory_item_id);
            inventoryItemToVariantShopifyId[variant.inventory_item_id.toString()] = variant.id.toString();
          }
          shopifyVariantIds.push(variant.id.toString());

          return {
            product_id: productUuid,
            shopify_id: variant.id.toString(),
            title: variant.title,
            sku: variant.sku,
            option1: variant.option1,
            option2: variant.option2,
            option3: variant.option3,
            inventory_item_id: inventoryItemId,
            price: variant.price ? parseFloat(variant.price) : 0,
            shopify_active: true,
          };
        });

        if (variantsToUpsert.length > 0) {
          const { error } = await supabase
            .from('product_variants')
            .upsert(variantsToUpsert, { onConflict: 'product_id,shopify_id' });

          if (error) {
            send(`Erreur variantes: ${error.message}`, 'error');
            return;
          }
        }

        send(`✓ ${variantsToUpsert.length} variantes`, 'success');

        // 4. Marquer les variantes absentes comme locales
        let localVariantsCount = 0;
        if (shopifyVariantIds.length > 0) {
          const { data: markedRows } = await supabase
            .from('product_variants')
            .update({ shopify_active: false })
            .eq('product_id', productUuid)
            .eq('shopify_active', true)
            .not('shopify_id', 'in', `(${shopifyVariantIds.join(',')})`)
            .select('id');

          localVariantsCount = markedRows?.length || 0;
        }

        if (localVariantsCount > 0) {
          send(`📌 ${localVariantsCount} variante${localVariantsCount > 1 ? 's' : ''} locale${localVariantsCount > 1 ? 's' : ''}`, 'info');
        }

        // 4b. Supprimer les variantes locales dupliquées
        await deduplicateLocalVariants(supabase, [productUuid], send);

        // 5. Récupérer les coûts
        // Shopify plafonne inventory_items.json à 250 résultats/page (50 par défaut).
        // Sans chunk + limit, les variantes aux inventory_item_id les plus élevés
        // (souvent les couleurs ajoutées en dernier) étaient silencieusement omises.
        send('Récupération des coûts...', 'info');
        if (inventoryItemIds.length > 0) {
          let costUpdated = 0;
          for (let i = 0; i < inventoryItemIds.length; i += 250) {
            const batch = inventoryItemIds.slice(i, i + 250);
            const costResponse = await fetch(
              `https://${shop.shopify_url}/admin/api/2024-01/inventory_items.json?ids=${batch.join(',')}&limit=250`,
              {
                headers: {
                  'X-Shopify-Access-Token': shop.shopify_token,
                  'Content-Type': 'application/json',
                },
              }
            );

            if (costResponse.ok) {
              const costData = await costResponse.json();
              for (const item of costData.inventory_items || []) {
                const cost = item.cost ? parseFloat(item.cost) : 0;
                const variantShopifyId = inventoryItemToVariantShopifyId[item.id.toString()];
                if (variantShopifyId) {
                  await supabase
                    .from('product_variants')
                    .update({ cost })
                    .eq('product_id', productUuid)
                    .eq('shopify_id', variantShopifyId);
                  costUpdated++;
                }
              }
            }
          }
          send(`✓ Coûts mis à jour (${costUpdated})`, 'success');
        }

        // 6. Récupérer les inventory levels
        send('Récupération des stocks...', 'info');
        const { data: dbVariants } = await supabase
          .from('product_variants')
          .select('id, shopify_id, inventory_item_id')
          .eq('product_id', productUuid);

        const variantIdMap: Record<string, string> = {};
        const inventoryItemToVariantUuid: Record<string, string> = {};
        dbVariants?.forEach((v: any) => {
          variantIdMap[v.shopify_id] = v.id;
          if (v.inventory_item_id) {
            inventoryItemToVariantUuid[v.inventory_item_id] = v.id;
          }
        });

        // Synchroniser les métachamps des variantes
        await syncVariantMetafields(
          supabase, shopId!, shop.shopify_url, shop.shopify_token, variantIdMap, send
        );

        let levelsCount = 0;
        if (inventoryItemIds.length > 0) {
          const levelsResponse = await fetch(
            `https://${shop.shopify_url}/admin/api/2024-01/inventory_levels.json?inventory_item_ids=${inventoryItemIds.join(',')}&limit=250`,
            {
              headers: {
                'X-Shopify-Access-Token': shop.shopify_token,
                'Content-Type': 'application/json',
              },
            }
          );

          if (levelsResponse.ok) {
            const levelsData = await levelsResponse.json();
            const inventoryToUpsert = [];

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

            if (inventoryToUpsert.length > 0) {
              await supabase
                .from('inventory_levels')
                .upsert(inventoryToUpsert, { onConflict: 'variant_id,location_id' });
              levelsCount = inventoryToUpsert.length;
            }
          }
        }

        send(`✓ ${levelsCount} niveaux de stock`, 'success');

        // 7. Construire le produit mis à jour pour le frontend
        const optionNames = {
          option1_name: shopifyProduct.options?.[0]?.name || null,
          option2_name: shopifyProduct.options?.[1]?.name || null,
          option3_name: shopifyProduct.options?.[2]?.name || null,
        };

        const { data: updatedVariants } = await supabase
          .from('product_variants')
          .select('id, shopify_id, title, sku, option1, option2, option3, cost, shopify_active, inventory_levels(quantity, location_id), variant_metafields(namespace, key, value)')
          .eq('product_id', productUuid);

        const variants = (updatedVariants || []).map((variant: any) => {
          const size = variant.option1;
          let quantity = 0;
          if (variant.inventory_levels && Array.isArray(variant.inventory_levels)) {
            if (locationId) {
              const level = variant.inventory_levels.find((l: any) => l.location_id === locationId);
              quantity = level?.quantity || 0;
            } else {
              quantity = variant.inventory_levels.reduce((sum: number, l: any) => sum + (l.quantity || 0), 0);
            }
          }

          return {
            id: `gid://shopify/ProductVariant/${variant.shopify_id}`,
            supabaseId: variant.id,
            title: variant.title,
            sku: variant.sku,
            quantity,
            size,
            cost: variant.cost || 0,
            shopifyActive: variant.shopify_active ?? true,
            options: [
              variant.option1 && { name: optionNames.option1_name || 'Option 1', value: variant.option1 },
              variant.option2 && { name: optionNames.option2_name || 'Option 2', value: variant.option2 },
              variant.option3 && { name: optionNames.option3_name || 'Option 3', value: variant.option3 },
            ].filter(Boolean),
            metafields: (variant.variant_metafields || []).map((mf: { namespace: string; key: string; value: string }) => ({
              namespace: mf.namespace,
              key: mf.key,
              value: mf.value,
            })),
          };
        });

        const totalQuantity = variants.reduce((sum: number, v: any) => sum + v.quantity, 0);
        const sizeBreakdown: Record<string, number> = {};
        variants.forEach((v: any) => {
          if (v.size) {
            sizeBreakdown[v.size] = (sizeBreakdown[v.size] || 0) + v.quantity;
          }
        });
        const costs = variants.map((v: any) => v.cost || 0);
        const costRange = costs.length > 0
          ? { min: Math.min(...costs), max: Math.max(...costs) }
          : undefined;

        const updatedProduct = {
          id: `gid://shopify/Product/${shopifyProduct.id}`,
          supabaseId: productUuid,
          title: shopifyProduct.title,
          handle: shopifyProduct.handle,
          status: shopifyProduct.status?.toUpperCase() || 'ACTIVE',
          image: shopifyProduct.image?.src || shopifyProduct.images?.[0]?.src || null,
          imageAlt: shopifyProduct.title,
          productType: shopifyProduct.product_type || null,
          totalQuantity,
          sizeBreakdown,
          costRange,
          variants,
          syncedAt: new Date().toISOString(),
        };

        send('', 'info');
        send(`✅ Synchronisation terminée`, 'success');

        // Envoyer le produit dans le message DONE
        sendResult(updatedProduct);

      } catch (error) {
        send(`Erreur: ${error}`, 'error');
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
