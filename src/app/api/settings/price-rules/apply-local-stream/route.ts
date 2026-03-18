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

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      
      const send = (message: string, type: string = 'info') => {
        const data = JSON.stringify({ message, type, timestamp: new Date().toISOString() });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      try {
        send('🚀 Démarrage de l\'application aux commandes...', 'info');
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

        // Récupérer la règle
        const { data: rule, error: ruleError } = await supabase
          .from('price_rules')
          .select(`*, modifiers:price_rule_modifiers(*), option_modifiers:price_rule_option_modifiers(*)`)
          .eq('id', ruleId)
          .single();

        if (ruleError || !rule) {
          send('❌ Règle non trouvée', 'error');
          controller.close();
          return;
        }

        send(`✓ Règle: ${rule.sku} (base: ${rule.base_price}€)`, 'success');
        
        if (rule.product_type) {
          send(`  └─ Type de produit: ${rule.product_type}`, 'info');
        }
        
        if (rule.modifiers?.length > 0) {
          send(`  └─ ${rule.modifiers.length} modificateur(s) métachamp`, 'info');
        }
        
        if (rule.option_modifiers?.length > 0) {
          send(`  └─ ${rule.option_modifiers.length} modificateur(s) d'option`, 'info');
        }

        send('', 'info');
        send('📋 Mise à jour des commandes...', 'info');

        // Récupérer les commandes en cours (non expédiées, non annulées, non remboursées)
        const { data: orders, error: ordersError } = await supabase
          .from('orders')
          .select('id, name, line_items, tags')
          .eq('shop_id', shopId)
          .is('cancelled_at', null)
          .neq('display_financial_status', 'REFUNDED');

        if (ordersError || !orders) {
          send('❌ Erreur lors de la récupération des commandes', 'error');
          controller.close();
          return;
        }

        // Exclude batch (stock) orders — they have their own apply-stock-stream
        const clientOrders = orders.filter(o => {
          const tags = o.tags;
          if (Array.isArray(tags)) return !tags.some(t => t.toLowerCase().includes('batch'));
          if (typeof tags === 'string') return !tags.toLowerCase().includes('batch');
          return true;
        });

        send(`  └─ ${clientOrders.length} commande(s) client à analyser`, 'info');

        let totalUpdated = 0;
        let totalOrders = 0;

        for (const order of clientOrders) {
          const lineItems = order.line_items || [];
          let orderUpdated = false;
          const updatedLineItems = [...lineItems];

          for (let i = 0; i < updatedLineItems.length; i++) {
            const item = updatedLineItems[i];
            const itemSku = item.sku || '';

            // Vérifier si le SKU correspond à la règle
            if (!itemSku.toUpperCase().startsWith(rule.sku.toUpperCase())) {
              continue;
            }

            let cost = rule.base_price;
            const costParts: string[] = [`${rule.base_price}€`];

            // Appliquer les modificateurs de métachamps si disponibles
            // Les métachamps sont stockés dans item.variant.metafields (tableau)
            const itemMetafields = item.variant?.metafields || [];
            
            for (const modifier of rule.modifiers || []) {
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
            for (const optMod of rule.option_modifiers || []) {
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
              totalUpdated++;
              
              const calcStr = costParts.length > 1 ? ` (${costParts.join(' ')})` : '';
              send(`  ✓ ${order.name} - ${itemSku} → ${cost.toFixed(2)}€${calcStr}`, 'progress');
            }
          }

          if (orderUpdated) {
            await supabase
              .from('orders')
              .update({ line_items: updatedLineItems })
              .eq('id', order.id);
            
            totalOrders++;
          }
        }

        // Mettre à jour la date de dernière application
        await supabase
          .from('price_rules')
          .update({ last_applied_at: new Date().toISOString() })
          .eq('id', ruleId);

        send('', 'info');
        send('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
        send(`✅ Terminé: ${totalUpdated} article(s) mis à jour dans ${totalOrders} commande(s)`, 'success');
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
