import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Pousse le stock local d'un produit vers Shopify (SSE stream).
 * Seules les variantes avec un inventory_item_id (= existantes sur Shopify) sont mises à jour.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get('shopId');
  const locationId = searchParams.get('locationId');
  const productId = searchParams.get('productId');

  if (!shopId || !locationId || !productId) {
    return new Response('Missing shopId, locationId or productId', { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (message: string, type: string = 'info') => {
        const data = JSON.stringify({ message, type, timestamp: new Date().toISOString() });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      try {
        // Récupérer la boutique
        const { data: shop, error: shopError } = await supabase
          .from('shops')
          .select('shopify_url, shopify_token')
          .eq('id', shopId)
          .single();

        if (shopError || !shop) {
          send('Boutique non trouvée', 'error');
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ message: 'DONE', type: 'error' })}\n\n`));
          controller.close();
          return;
        }

        send('Récupération des variantes...', 'info');

        // Récupérer les variantes du produit avec inventory_item_id et niveaux de stock
        const { data: variants, error: variantsError } = await supabase
          .from('product_variants')
          .select(`
            id,
            shopify_id,
            title,
            sku,
            inventory_item_id,
            inventory_levels(
              quantity,
              location_id
            )
          `)
          .eq('product_id', productId);

        if (variantsError || !variants) {
          send('Erreur lors de la récupération des variantes', 'error');
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ message: 'DONE', type: 'error' })}\n\n`));
          controller.close();
          return;
        }

        // Filtrer les variantes qui ont un inventory_item_id (= existent sur Shopify)
        const pushable = variants.filter(v => v.inventory_item_id);
        const skipped = variants.length - pushable.length;

        if (pushable.length === 0) {
          send('Aucune variante avec un inventory_item_id. Rien à pousser.', 'warning');
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ message: 'DONE', type: 'success' })}\n\n`));
          controller.close();
          return;
        }

        send(`📦 ${pushable.length} variante(s) à pousser vers Shopify${skipped > 0 ? ` (${skipped} ignorée(s) sans ID Shopify)` : ''}`, 'info');

        const shopifyUrl = shop.shopify_url.replace(/\/$/, '');
        let pushed = 0;
        let errors = 0;
        const confirmedVariantIds: string[] = [];
        const CONCURRENT = 4; // 4 requêtes en parallèle (bucket REST = 40, très safe)

        for (let i = 0; i < pushable.length; i += CONCURRENT) {
          const chunk = pushable.slice(i, i + CONCURRENT);

          send(`  └─ ${i + 1}-${Math.min(i + CONCURRENT, pushable.length)}/${pushable.length}...`, 'progress');

          const results = await Promise.allSettled(
            chunk.map(async (variant) => {
              const levels = Array.isArray(variant.inventory_levels) ? variant.inventory_levels : [];
              const level = levels.find((l: { location_id: string }) => l.location_id === locationId);
              const quantity = level?.quantity ?? 0;

              const response = await fetch(
                `https://${shopifyUrl}/admin/api/2024-01/inventory_levels/set.json`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': shop.shopify_token,
                  },
                  body: JSON.stringify({
                    location_id: parseInt(locationId),
                    inventory_item_id: parseInt(variant.inventory_item_id),
                    available: quantity,
                  }),
                }
              );

              if (!response.ok) {
                const errText = await response.text();
                throw new Error(errText);
              }
              return variant.id;
            })
          );

          for (let j = 0; j < results.length; j++) {
            const result = results[j];
            if (result.status === 'fulfilled') {
              pushed++;
              confirmedVariantIds.push(result.value);
            } else {
              const label = chunk[j].sku || chunk[j].title || chunk[j].shopify_id;
              send(`    ❌ ${label}: ${result.reason?.message || result.reason}`, 'error');
              errors++;
            }
          }

          // Petit délai entre les batches pour rester dans le rate limit
          if (i + CONCURRENT < pushable.length) {
            await new Promise(resolve => setTimeout(resolve, 250));
          }
        }

        // Marquer les variantes confirmées comme actives sur Shopify
        if (confirmedVariantIds.length > 0) {
          send(`🔄 Mise à jour du statut des variantes...`, 'info');
          for (let i = 0; i < confirmedVariantIds.length; i += 500) {
            const batch = confirmedVariantIds.slice(i, i + 500);
            await supabase
              .from('product_variants')
              .update({ shopify_active: true })
              .in('id', batch);
          }

          // Si au moins une variante est confirmée, passer le produit en actif
          const { data: productData } = await supabase
            .from('products')
            .select('status')
            .eq('id', productId)
            .single();

          if (productData && (productData.status === 'local' || productData.status === 'draft')) {
            await supabase
              .from('products')
              .update({ status: 'active' })
              .eq('id', productId);
            send(`✅ Produit repassé en actif (était ${productData.status})`, 'success');
          }
        }

        // Résumé
        if (errors > 0) {
          send(`⚠️ ${pushed} variante(s) poussée(s), ${errors} erreur(s)`, 'warning');
        } else {
          send(`✓ ${pushed} variante(s) poussée(s) vers Shopify`, 'success');
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ message: 'DONE', type: 'success' })}\n\n`));
      } catch (error) {
        console.error('Error pushing product to Shopify:', error);
        send('Erreur inattendue', 'error');
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ message: 'DONE', type: 'error' })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
