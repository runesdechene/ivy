import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET - Récupérer toutes les règles de prix
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');

    if (!shopId) {
      return NextResponse.json({ error: 'Missing shopId' }, { status: 400 });
    }

    // Récupérer les règles avec leurs modificateurs et options
    let { data: rules, error } = await supabase
      .from('price_rules')
      .select(`
        *,
        modifiers:price_rule_modifiers(*),
        option_modifiers:price_rule_option_modifiers(*)
      `)
      .eq('shop_id', shopId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    // Si la colonne sort_order n'existe pas encore, fallback sans tri
    if (error && error.message.includes('sort_order')) {
      const fallback = await supabase
        .from('price_rules')
        .select(`
          *,
          modifiers:price_rule_modifiers(*),
          option_modifiers:price_rule_option_modifiers(*)
        `)
        .eq('shop_id', shopId)
        .order('created_at', { ascending: true });
      rules = fallback.data;
      error = fallback.error;
    }

    // Si la table n'existe pas encore, retourner un tableau vide
    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ rules: [] });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ rules: rules || [] });

  } catch (error) {
    console.error('Error fetching price rules:', error);
    return NextResponse.json({ error: 'Failed to fetch price rules' }, { status: 500 });
  }
}

// POST - Créer une nouvelle règle de prix
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { shopId, sku, basePrice, description, productType, localOnly, title, modifiers, optionModifiers } = body;

    if (!shopId || !sku) {
      return NextResponse.json({ error: 'Missing shopId or sku' }, { status: 400 });
    }

    // Créer la règle
    const { data: rule, error: ruleError } = await supabase
      .from('price_rules')
      .insert({
        shop_id: shopId,
        sku,
        base_price: basePrice || 0,
        description: description || null,
        product_type: productType || null,
        local_only: localOnly || false,
        title: title || null,
      })
      .select()
      .single();

    if (ruleError) {
      return NextResponse.json({ error: ruleError.message }, { status: 500 });
    }

    // Ajouter les modificateurs si présents
    if (modifiers && modifiers.length > 0) {
      const modifiersToInsert = modifiers.map((mod: any) => ({
        price_rule_id: rule.id,
        metafield_namespace: mod.namespace,
        metafield_key: mod.key,
        metafield_value: mod.value,
        modifier_amount: mod.amount || 0,
      }));

      const { error: modError } = await supabase
        .from('price_rule_modifiers')
        .insert(modifiersToInsert);

      if (modError) {
        console.error('Error inserting modifiers:', modError);
      }
    }

    // Ajouter les modificateurs d'options si présents
    if (optionModifiers && optionModifiers.length > 0) {
      const optionModifiersToInsert = optionModifiers.map((mod: any) => ({
        price_rule_id: rule.id,
        option_name: mod.optionName,
        option_value: mod.optionValue,
        modifier_amount: mod.amount || 0,
      }));

      const { error: optModError } = await supabase
        .from('price_rule_option_modifiers')
        .insert(optionModifiersToInsert);

      if (optModError) {
        console.error('Error inserting option modifiers:', optModError);
      }
    }

    // Récupérer la règle complète avec modificateurs
    const { data: fullRule } = await supabase
      .from('price_rules')
      .select(`
        *,
        modifiers:price_rule_modifiers(*),
        option_modifiers:price_rule_option_modifiers(*)
      `)
      .eq('id', rule.id)
      .single();

    return NextResponse.json({ rule: fullRule });

  } catch (error) {
    console.error('Error creating price rule:', error);
    return NextResponse.json({ error: 'Failed to create price rule' }, { status: 500 });
  }
}

// PUT - Mettre à jour une règle de prix
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, sku, basePrice, description, isActive, productType, localOnly, title, modifiers, optionModifiers } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing rule id' }, { status: 400 });
    }

    // Mettre à jour la règle
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (sku !== undefined) updateData.sku = sku;
    if (basePrice !== undefined) updateData.base_price = basePrice;
    if (description !== undefined) updateData.description = description;
    if (isActive !== undefined) updateData.is_active = isActive;
    if (productType !== undefined) updateData.product_type = productType;
    if (localOnly !== undefined) updateData.local_only = localOnly;
    if (title !== undefined) updateData.title = title;

    const { error: ruleError } = await supabase
      .from('price_rules')
      .update(updateData)
      .eq('id', id);

    if (ruleError) {
      return NextResponse.json({ error: ruleError.message }, { status: 500 });
    }

    // Mettre à jour les modificateurs si fournis
    if (modifiers !== undefined) {
      // Supprimer les anciens modificateurs
      await supabase
        .from('price_rule_modifiers')
        .delete()
        .eq('price_rule_id', id);

      // Ajouter les nouveaux
      if (modifiers.length > 0) {
        const modifiersToInsert = modifiers.map((mod: any) => ({
          price_rule_id: id,
          metafield_namespace: mod.namespace,
          metafield_key: mod.key,
          metafield_value: mod.value,
          modifier_amount: mod.amount || 0,
        }));

        await supabase
          .from('price_rule_modifiers')
          .insert(modifiersToInsert);
      }
    }

    // Mettre à jour les modificateurs d'options si fournis
    if (optionModifiers !== undefined) {
      // Supprimer les anciens
      await supabase
        .from('price_rule_option_modifiers')
        .delete()
        .eq('price_rule_id', id);

      // Ajouter les nouveaux
      if (optionModifiers.length > 0) {
        const optionModifiersToInsert = optionModifiers.map((mod: any) => ({
          price_rule_id: id,
          option_name: mod.optionName,
          option_value: mod.optionValue,
          modifier_amount: mod.amount || 0,
        }));

        await supabase
          .from('price_rule_option_modifiers')
          .insert(optionModifiersToInsert);
      }
    }

    // Récupérer la règle mise à jour
    const { data: fullRule } = await supabase
      .from('price_rules')
      .select(`
        *,
        modifiers:price_rule_modifiers(*),
        option_modifiers:price_rule_option_modifiers(*)
      `)
      .eq('id', id)
      .single();

    return NextResponse.json({ rule: fullRule });

  } catch (error) {
    console.error('Error updating price rule:', error);
    return NextResponse.json({ error: 'Failed to update price rule' }, { status: 500 });
  }
}

// DELETE - Supprimer une règle de prix
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing rule id' }, { status: 400 });
    }

    // Les modificateurs seront supprimés automatiquement grâce à ON DELETE CASCADE
    const { error } = await supabase
      .from('price_rules')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error deleting price rule:', error);
    return NextResponse.json({ error: 'Failed to delete price rule' }, { status: 500 });
  }
}
