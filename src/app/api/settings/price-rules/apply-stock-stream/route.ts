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
        send('🚀 Application aux commandes de stock...', 'info');
        send('', 'info');

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

        // Fetch the rule with modifiers
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
        send('📋 Récupération des commandes de stock (supplier_orders)...', 'info');

        // Fetch all supplier orders for this shop
        const { data: supplierOrders, error: ordersError } = await supabase
          .from('supplier_orders')
          .select('id, order_number')
          .eq('shop_id', shopId);

        if (ordersError || !supplierOrders) {
          send('❌ Erreur lors de la récupération des commandes de stock', 'error');
          controller.close();
          return;
        }

        send(`  └─ ${supplierOrders.length} commande(s) de stock trouvée(s)`, 'info');

        if (supplierOrders.length === 0) {
          send('', 'info');
          send('✅ Aucune commande de stock à traiter', 'success');
          send('DONE', 'success');
          controller.close();
          return;
        }

        // Fetch all items from these orders that match the SKU
        const orderIds = supplierOrders.map(o => o.id);
        const orderNameMap = new Map(supplierOrders.map(o => [o.id, o.order_number]));

        let allItems: any[] = [];
        for (let i = 0; i < orderIds.length; i += 100) {
          const chunk = orderIds.slice(i, i + 100);
          const { data: items } = await supabase
            .from('supplier_order_items')
            .select('id, order_id, variant_id, product_title, variant_title, sku, quantity, unit_price, metafields')
            .in('order_id', chunk);

          if (items) {
            allItems = [...allItems, ...items];
          }
        }

        send(`  └─ ${allItems.length} article(s) au total`, 'info');
        send(`  └─ Recherche SKU commençant par: "${rule.sku}"`, 'info');

        // Load metafield_config to map namespace+key → display_name
        // supplier_order_items stores metafields as { "DisplayName": "value" }
        // but price_rule_modifiers stores namespace + key (e.g. "custom" + "fichier_d_impression")
        const { data: metafieldConfigs } = await supabase
          .from('metafield_config')
          .select('namespace, key, display_name')
          .eq('shop_id', shopId)
          .eq('is_active', true);

        const metafieldKeyToDisplayName = new Map<string, string>();
        (metafieldConfigs || []).forEach((mc: any) => {
          metafieldKeyToDisplayName.set(`${mc.namespace}.${mc.key}`, mc.display_name);
        });

        send('', 'info');

        let totalUpdated = 0;
        let totalSkipped = 0;

        for (const item of allItems) {
          const itemSku = item.sku || '';

          // Match by SKU
          if (!itemSku.toUpperCase().startsWith(rule.sku.toUpperCase())) {
            continue;
          }

          let cost = rule.base_price;
          const costParts: string[] = [`${rule.base_price}€`];

          // Apply metafield modifiers
          // Item metafields are stored as { "DisplayName": "value" } (e.g. {"Recto": "DTG-CUI"})
          const itemMetafields = item.metafields || {};

          for (const modifier of rule.modifiers || []) {
            // Resolve display name from namespace+key via metafield_config
            const configKey = `${modifier.metafield_namespace}.${modifier.metafield_key}`;
            const displayName = metafieldKeyToDisplayName.get(configKey);

            // Try matching by display name first, then fallback to raw key
            const value = (displayName ? itemMetafields[displayName] : null)
              ?? itemMetafields[modifier.metafield_key]
              ?? null;

            const matched = value === modifier.metafield_value;

            if (matched) {
              cost += modifier.modifier_amount;
              const sign = modifier.modifier_amount >= 0 ? '+' : '';
              costParts.push(`${sign}${modifier.modifier_amount}€ (${modifier.metafield_value})`);
            }
          }

          // Apply option modifiers (from variant_title: "Noir / XL")
          const itemOptions = item.variant_title?.split(' / ') || [];
          for (const optMod of rule.option_modifiers || []) {
            const match = itemOptions.some(
              (opt: string) => opt.trim().toLowerCase() === optMod.option_value.toLowerCase()
            );

            if (match) {
              cost += optMod.modifier_amount;
              const sign = optMod.modifier_amount >= 0 ? '+' : '';
              costParts.push(`${sign}${optMod.modifier_amount}€ (${optMod.option_value})`);
            }
          }

          // Update if cost changed
          if (item.unit_price !== cost) {
            const { error: updateError } = await supabase
              .from('supplier_order_items')
              .update({
                unit_price: cost,
                line_total: cost * (item.quantity || 1),
              })
              .eq('id', item.id);

            if (updateError) {
              send(`  ✗ Erreur sur ${itemSku}: ${updateError.message}`, 'error');
            } else {
              totalUpdated++;
              const orderName = orderNameMap.get(item.order_id) || '?';
              const calcStr = costParts.length > 1 ? ` (${costParts.join(' ')})` : '';
              send(`  ✓ ${orderName} - ${itemSku} ${item.variant_title || ''} → ${cost.toFixed(2)}€${calcStr}`, 'progress');
            }
          } else {
            totalSkipped++;
          }
        }

        // Update order totals for affected orders
        const affectedOrderIds = [...new Set(allItems.filter(i => {
          const sku = i.sku || '';
          return sku.toUpperCase().startsWith(rule.sku.toUpperCase());
        }).map(i => i.order_id))];

        for (const oid of affectedOrderIds) {
          const { data: orderItems } = await supabase
            .from('supplier_order_items')
            .select('line_total')
            .eq('order_id', oid);

          if (orderItems) {
            const subtotal = orderItems.reduce((sum, i) => sum + (i.line_total || 0), 0);
            await supabase
              .from('supplier_orders')
              .update({ subtotal, updated_at: new Date().toISOString() })
              .eq('id', oid);
          }
        }

        // Update last applied timestamp
        await supabase
          .from('price_rules')
          .update({ last_applied_at: new Date().toISOString() })
          .eq('id', ruleId);

        send('', 'info');
        send('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
        send(`✅ Terminé: ${totalUpdated} article(s) mis à jour, ${totalSkipped} déjà à jour`, 'success');
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
