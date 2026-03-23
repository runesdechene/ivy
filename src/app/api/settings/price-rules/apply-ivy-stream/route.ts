import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
        send('🚀 Application des prix sur les variantes Ivy (Supabase)...', 'info');
        send('', 'info');

        // Récupérer la règle avec ses modificateurs
        const { data: rule, error: ruleError } = await supabase
          .from('price_rules')
          .select(`*, modifiers:price_rule_modifiers(*), option_modifiers:price_rule_option_modifiers(*)`)
          .eq('id', ruleId)
          .single();

        if (ruleError || !rule) {
          send('❌ Règle non trouvée', 'error');
          send('DONE', 'error');
          return;
        }

        if (!rule.sku) {
          send('❌ La règle doit avoir un SKU défini', 'error');
          send('DONE', 'error');
          return;
        }

        send(`✓ Règle: ${rule.sku} (base: ${rule.base_price}€)`, 'success');

        if (rule.modifiers?.length > 0) {
          send(`  └─ ${rule.modifiers.length} modificateur(s) métachamp`, 'info');
        }

        if (rule.option_modifiers?.length > 0) {
          send(`  └─ ${rule.option_modifiers.length} modificateur(s) d'option`, 'info');
        }

        // Récupérer les produits avec leurs variantes (on filtre par SKU ensuite)
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
          .in('status', ['active', 'local', 'draft']);

        if (productsError) {
          send(`❌ Erreur de récupération: ${productsError.message}`, 'error');
          send('DONE', 'error');
          return;
        }

        if (!products || products.length === 0) {
          send(`⚠️ Aucun produit trouvé`, 'warning');
          send('DONE', 'success');
          return;
        }

        // Filter variants by SKU prefix
        const skuPrefix = rule.sku.toUpperCase();
        for (const product of products) {
          (product as any).variants = ((product.variants as any[]) || []).filter(
            (v: any) => (v.sku || '').toUpperCase().startsWith(skuPrefix)
          );
        }
        // Remove products with no matching variants
        const filteredProducts = products.filter(p => ((p.variants as any[])?.length || 0) > 0);

        if (filteredProducts.length === 0) {
          send(`⚠️ Aucune variante trouvée pour le SKU "${rule.sku}"`, 'warning');
          send('DONE', 'success');
          return;
        }

        // Filtrer les variantes locales si la règle est local_only
        if (rule.local_only) {
          for (const product of filteredProducts) {
            (product as any).variants = ((product.variants as any[]) || []).filter(
              (v: any) => v.shopify_active === false
            );
          }
          send('🔒 Filtre: variantes locales seulement (shopify_active = false)', 'info');
        }

        // Compter les variantes totales
        const totalVariants = filteredProducts.reduce((sum, p) => sum + ((p.variants as any[])?.length || 0), 0);

        if (totalVariants === 0) {
          send(`⚠️ Aucune variante trouvée pour le SKU "${rule.sku}"`, 'warning');
          send('DONE', 'success');
          return;
        }

        send(`✓ ${filteredProducts.length} produit(s), ${totalVariants} variante(s) à traiter`, 'success');
        send('', 'info');
        send('🔄 Calcul et mise à jour des coûts...', 'info');

        let updatedCount = 0;
        let skippedCount = 0;
        let variantIndex = 0;

        // Charger les métachamps des variantes si des modificateurs métachamp existent
        let variantMetafieldsMap: Record<string, Array<{ namespace: string; key: string; value: string }>> = {};
        if (rule.modifiers?.length > 0) {
          const variantIds = filteredProducts.flatMap(p => ((p.variants as any[]) || []).map((v: any) => v.id));
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
                send(`  └─ ${metafieldsData.length} métachamp(s) chargé(s)`, 'info');
              }
            } catch {
              send('  └─ Table variant_metafields non disponible, modificateurs métachamp ignorés', 'warning');
            }
          }
        }

        for (const product of filteredProducts) {
          const optionNames = {
            option1: product.option1_name || 'Option 1',
            option2: product.option2_name || 'Option 2',
            option3: product.option3_name || 'Option 3',
          };

          for (const variant of (product.variants as any[]) || []) {
            if (streamClosed) break;
            variantIndex++;

            const variantLabel = `${variant.sku || 'no-sku'} - ${variant.title || product.title}`;

            // Calculer le coût
            let cost = rule.base_price;
            const costParts: string[] = [`${rule.base_price}€`];

            // Appliquer les modificateurs de métachamps
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

            // Appliquer les modificateurs d'options
            // Construire les selectedOptions à partir de option1/2/3 + noms
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

            // Mettre à jour si le coût a changé
            const roundedCost = Math.round(cost * 100) / 100;
            const currentCost = variant.cost || 0;

            if (Math.abs(roundedCost - currentCost) < 0.005) {
              skippedCount++;
              if (skippedCount % 50 === 0) {
                send(`  ⏭️ ${skippedCount} variante(s) inchangée(s)...`, 'info');
              }
              continue;
            }

            const { error: updateError } = await supabase
              .from('product_variants')
              .update({ cost: roundedCost })
              .eq('id', variant.id);

            if (updateError) {
              send(`  ❌ [${variantIndex}/${totalVariants}] ${variantLabel}: ${updateError.message}`, 'error');
            } else {
              const calcStr = costParts.length > 1 ? ` (${costParts.join(' ')})` : '';
              send(`  ✓ [${variantIndex}/${totalVariants}] ${variantLabel} → ${roundedCost.toFixed(2)}€${calcStr}`, 'progress');
              updatedCount++;
            }
          }

          if (streamClosed) break;
        }

        // Mettre à jour la date de dernière application
        await supabase
          .from('price_rules')
          .update({ last_applied_at: new Date().toISOString() })
          .eq('id', ruleId);

        send('', 'info');
        send('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
        send(`✅ Terminé: ${updatedCount} mise(s) à jour, ${skippedCount} inchangée(s)`, 'success');
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
