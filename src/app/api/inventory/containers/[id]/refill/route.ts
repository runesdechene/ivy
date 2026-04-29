import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

interface RefillLine {
  variantId: string;
  quantity: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: containerId } = await params;

  let body: { shopId?: string; orderId?: string; lines?: RefillLine[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { shopId, orderId, lines } = body;

  if (!shopId) {
    return NextResponse.json({ error: 'shopId required' }, { status: 400 });
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json({ error: 'Aucune ligne à ajouter' }, { status: 400 });
  }

  const cleanLines = lines.filter(
    (l) => l && typeof l.variantId === 'string' && typeof l.quantity === 'number' && l.quantity > 0,
  );
  if (cleanLines.length === 0) {
    return NextResponse.json({ error: 'Toutes les quantités sont à 0' }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: container } = await supabase
    .from('container_instances')
    .select('id, shop_id')
    .eq('id', containerId)
    .maybeSingle();
  if (!container || container.shop_id !== shopId) {
    return NextResponse.json({ error: 'Container not found' }, { status: 404 });
  }

  let targetOrderId: string;
  let targetOrderNumber: string;

  if (orderId) {
    const { data: existing } = await supabase
      .from('supplier_orders')
      .select('id, order_number, status, shop_id, balance_adjustment')
      .eq('id', orderId)
      .maybeSingle();
    if (!existing || existing.shop_id !== shopId) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (existing.status !== 'draft') {
      return NextResponse.json(
        { error: "Cette commande n'est plus modifiable (status ≠ draft)" },
        { status: 409 },
      );
    }
    targetOrderId = existing.id;
    targetOrderNumber = existing.order_number;
  } else {
    const { count } = await supabase
      .from('supplier_orders')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shopId);
    const newNumber = `BATCH-${String((count || 0) + 1).padStart(4, '0')}`;
    const { data: newOrder, error: createErr } = await supabase
      .from('supplier_orders')
      .insert({
        shop_id: shopId,
        order_number: newNumber,
        status: 'draft',
      })
      .select('id, order_number')
      .single();
    if (createErr || !newOrder) {
      return NextResponse.json(
        { error: createErr?.message || 'Failed to create order' },
        { status: 500 },
      );
    }
    targetOrderId = newOrder.id;
    targetOrderNumber = newOrder.order_number;
  }

  const { data: existingItems } = await supabase
    .from('supplier_order_items')
    .select('id, variant_id, quantity, line_total, unit_price')
    .eq('order_id', targetOrderId);
  const existingByVariant = new Map<string, NonNullable<typeof existingItems>[number]>();
  for (const it of existingItems ?? []) {
    if (it.variant_id) existingByVariant.set(it.variant_id, it);
  }

  const variantIds = cleanLines.map((l) => l.variantId);
  const { data: variantsInfo } = await supabase
    .from('product_variants')
    .select(`
      id, sku, title, option1, option2, option3,
      product:products(title)
    `)
    .in('id', variantIds);
  const variantInfoById = new Map(
    (variantsInfo ?? []).map((v: any) => {
      const product = Array.isArray(v.product) ? v.product[0] : v.product;
      return [
        v.id,
        {
          sku: v.sku,
          variantTitle: [v.option1, v.option2, v.option3].filter(Boolean).join(' · ') || v.title || null,
          productTitle: product?.title || 'Produit inconnu',
        },
      ];
    }),
  );

  const errors: Array<{ variantId: string; reason: string }> = [];
  let linesAdded = 0;
  let linesIncremented = 0;

  for (const line of cleanLines) {
    const info = variantInfoById.get(line.variantId);
    if (!info) {
      errors.push({ variantId: line.variantId, reason: 'Variant not found' });
      continue;
    }

    const existing = existingByVariant.get(line.variantId);
    if (existing) {
      const newQty = existing.quantity + line.quantity;
      const newLineTotal = (Number(existing.unit_price) || 0) * newQty;
      const { error: updErr } = await supabase
        .from('supplier_order_items')
        .update({
          quantity: newQty,
          line_total: newLineTotal,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      if (updErr) {
        errors.push({ variantId: line.variantId, reason: updErr.message });
      } else {
        linesIncremented += 1;
      }
    } else {
      const { error: insErr } = await supabase
        .from('supplier_order_items')
        .insert({
          order_id: targetOrderId,
          variant_id: line.variantId,
          product_title: info.productTitle,
          variant_title: info.variantTitle,
          sku: info.sku,
          quantity: line.quantity,
          unit_price: 0,
          line_total: 0,
          is_validated: false,
        });
      if (insErr) {
        errors.push({ variantId: line.variantId, reason: insErr.message });
      } else {
        linesAdded += 1;
      }
    }
  }

  const { data: refreshedItems } = await supabase
    .from('supplier_order_items')
    .select('line_total')
    .eq('order_id', targetOrderId);
  const subtotal = (refreshedItems ?? []).reduce(
    (s, it) => s + (Number(it.line_total) || 0),
    0,
  );
  const { data: orderRow } = await supabase
    .from('supplier_orders')
    .select('balance_adjustment')
    .eq('id', targetOrderId)
    .single();
  const balance = Number(orderRow?.balance_adjustment) || 0;
  const totalHt = subtotal + balance;
  await supabase
    .from('supplier_orders')
    .update({
      subtotal,
      total_ht: totalHt,
      total_ttc: totalHt * 1.2,
      updated_at: new Date().toISOString(),
    })
    .eq('id', targetOrderId);

  return NextResponse.json({
    orderId: targetOrderId,
    orderNumber: targetOrderNumber,
    linesAdded,
    linesIncremented,
    errors: errors.length > 0 ? errors : undefined,
  });
}
