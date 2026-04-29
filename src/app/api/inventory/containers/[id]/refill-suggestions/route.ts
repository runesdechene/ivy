import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';
import { computeRefillSuggestions, VariantInput } from '@/utils/refill-math';

const COLOR_OPTION_NAMES = ['couleur', 'color', 'colour'];
const SIZE_OPTION_NAMES = ['taille', 'size'];

function extractByOptionName(
  variant: { option1?: string | null; option2?: string | null; option3?: string | null },
  product: { option1_name?: string | null; option2_name?: string | null; option3_name?: string | null },
  matchNames: string[],
): string | null {
  const slots: Array<[string | null | undefined, string | null | undefined]> = [
    [product.option1_name, variant.option1],
    [product.option2_name, variant.option2],
    [product.option3_name, variant.option3],
  ];
  for (const [name, value] of slots) {
    if (name && matchNames.includes(String(name).toLowerCase()) && value) {
      return value;
    }
  }
  return null;
}

function dateRangeFromDays(days: number): { from: string; to: string } {
  const today = new Date();
  const past = new Date(today);
  past.setDate(today.getDate() - days);
  return {
    from: past.toISOString().split('T')[0],
    to: today.toISOString().split('T')[0],
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: containerId } = await params;
  const url = new URL(request.url);
  const windowParam = url.searchParams.get('window') || '30d';
  const zoneId = url.searchParams.get('zoneId');

  if (!['7d', '30d', 'all', 'zone'].includes(windowParam)) {
    return NextResponse.json({ error: 'Invalid window' }, { status: 400 });
  }
  if (windowParam === 'zone' && !zoneId) {
    return NextResponse.json({ error: 'zoneId required when window=zone' }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: container, error: cErr } = await supabase
    .from('container_instances')
    .select(`
      id, shop_id, location_id, name,
      filter_product_type, filter_size,
      type:container_types(id, name, max_capacity)
    `)
    .eq('id', containerId)
    .maybeSingle();

  if (cErr || !container) {
    return NextResponse.json({ error: 'Container not found' }, { status: 404 });
  }
  const type = Array.isArray(container.type) ? container.type[0] : container.type;
  const containerName = container.name?.trim() || type.name;
  const isFilterMode = !!(container.filter_product_type || container.filter_size);

  const { data: colorRules } = await supabase
    .from('color_rules')
    .select('reception_name, hex_value')
    .eq('shop_id', container.shop_id);
  const colorHexMap = new Map<string, string>();
  for (const r of colorRules ?? []) {
    if (r.reception_name) {
      colorHexMap.set(String(r.reception_name).toLowerCase().trim(), r.hex_value || '');
    }
  }
  const resolveHex = (color: string | null): string | null =>
    color ? colorHexMap.get(color.toLowerCase().trim()) || null : null;

  // Résoudre les produits selon le mode (filtre ou affectation explicite).
  let products: any[] = [];
  if (isFilterMode) {
    let q = supabase
      .from('products')
      .select('id, title, status, option1_name, option2_name, option3_name')
      .eq('shop_id', container.shop_id);
    if (container.filter_product_type) {
      q = q.eq('product_type', container.filter_product_type);
    }
    const { data } = await q;
    products = data ?? [];
  } else {
    const { data: cipRows } = await supabase
      .from('container_instance_products')
      .select(`
        product:products(
          id, title, status,
          option1_name, option2_name, option3_name
        )
      `)
      .eq('container_instance_id', containerId);
    products = (cipRows ?? [])
      .map((r: any) => r.product)
      .filter(Boolean);
  }
  const productIds = products.map((p: any) => p.id);

  if (productIds.length === 0) {
    return NextResponse.json({
      containerId,
      containerName,
      capacity: { max: type.max_capacity, current: 0, pct: 0 },
      window: { type: 'days', label: 'Aucun produit affecté' },
      products: [],
    });
  }

  const { data: variantsRaw } = await supabase
    .from('product_variants')
    .select(`
      id, product_id, sku, title, option1, option2, option3, shopify_active
    `)
    .in('product_id', productIds);

  // On garde TOUTES les variantes des produits candidats (pas de filtre
  // shopify_active côté serveur) pour que le total currentInBox du modal
  // matche celui affiché sur la card extérieure.
  // En mode filtre avec filter_size renseigné, on filtre les variants dont
  // la taille extraite ne matche pas — cohérent avec la card.
  const productById = new Map(products.map((p: any) => [p.id, p]));
  const allVariants = variantsRaw ?? [];
  const variants = (isFilterMode && container.filter_size)
    ? allVariants.filter((v: any) => {
        const p: any = productById.get(v.product_id);
        if (!p) return false;
        const size = extractByOptionName(v, p, SIZE_OPTION_NAMES);
        return size === container.filter_size;
      })
    : allVariants;
  const variantIds = variants.map((v: any) => v.id);

  if (variantIds.length === 0) {
    return NextResponse.json({
      containerId,
      containerName,
      capacity: { max: type.max_capacity, current: 0, pct: 0 },
      window: { type: 'days', label: 'Aucune variante' },
      products: [],
    });
  }

  const { data: locRow } = await supabase
    .from('locations')
    .select('id')
    .eq('shopify_id', container.location_id)
    .maybeSingle();
  const locationUuid = locRow?.id;

  let dateRange: { from: string; to: string } | null = null;
  let windowLabel = 'Depuis toujours';
  let windowType: 'days' | 'zone' | 'all' = 'all';

  if (windowParam === 'zone') {
    const { data: zone } = await supabase
      .from('pos_study_zones')
      .select('id, name, start_date, end_date')
      .eq('id', zoneId)
      .maybeSingle();
    if (!zone) {
      return NextResponse.json({ error: 'Zone not found' }, { status: 404 });
    }
    dateRange = { from: zone.start_date, to: zone.end_date };
    windowLabel = zone.name;
    windowType = 'zone';
  } else if (windowParam !== 'all') {
    const days = windowParam === '7d' ? 7 : 30;
    dateRange = dateRangeFromDays(days);
    windowLabel = windowParam === '7d' ? '7 derniers jours' : '30 derniers jours';
    windowType = 'days';
  }

  // Lifetime sales (no date filter) — used to filter "dead variants" (5XL never sold etc.)
  let lifetimeQuery = supabase
    .from('stock_movements')
    .select('variant_id, quantity')
    .in('variant_id', variantIds)
    .lt('quantity', 0);
  if (locationUuid) lifetimeQuery = lifetimeQuery.eq('location_id', locationUuid);
  const { data: lifetimeMovements } = await lifetimeQuery;

  const lifetimeSoldByVariant = new Map<string, number>();
  for (const m of lifetimeMovements ?? []) {
    const prev = lifetimeSoldByVariant.get(m.variant_id) || 0;
    lifetimeSoldByVariant.set(m.variant_id, prev + Math.abs(m.quantity));
  }

  // On affiche toutes les variantes vivantes des produits affectés. Le filtre se
  // fait visuellement côté UI (opacity réduite sur les lignes sans qty).
  // soldLifetime reste exposé pour permettre des décisions futures.
  const filteredVariants = variants;
  const filteredVariantIds = filteredVariants.map((v: any) => v.id);

  // Window-scoped sales (only for filtered variants)
  let mvtQuery = supabase
    .from('stock_movements')
    .select('variant_id, quantity')
    .in('variant_id', filteredVariantIds)
    .lt('quantity', 0);
  if (locationUuid) mvtQuery = mvtQuery.eq('location_id', locationUuid);
  if (dateRange) {
    mvtQuery = mvtQuery.gte('moved_on', dateRange.from).lte('moved_on', dateRange.to);
  }
  const { data: movements } = await mvtQuery;

  const soldByVariant = new Map<string, number>();
  for (const m of movements ?? []) {
    const prev = soldByVariant.get(m.variant_id) || 0;
    soldByVariant.set(m.variant_id, prev + Math.abs(m.quantity));
  }

  const { data: levels } = await supabase
    .from('inventory_levels')
    .select('variant_id, quantity')
    .in('variant_id', filteredVariantIds)
    .eq('location_id', container.location_id);

  const qtyByVariant = new Map<string, number>();
  for (const l of levels ?? []) {
    qtyByVariant.set(l.variant_id, Math.max(0, l.quantity || 0));
  }

  // Quantités déjà engagées dans des supplier_orders non-completed (draft +
  // in_progress). Évite que l'utilisateur double-commande sans s'en rendre
  // compte. On lit direct dans supplier_order_items, donc le chiffre suit
  // toute édition de la commande (qty modifiée, ligne supprimée, etc.) au
  // prochain refetch.
  const { data: openOrders } = await supabase
    .from('supplier_orders')
    .select('id, order_number, status')
    .eq('shop_id', container.shop_id)
    .in('status', ['draft', 'in_progress']);

  const orderInfoById = new Map(
    (openOrders ?? []).map((o: { id: string; order_number: string; status: string }) => [
      o.id,
      { orderNumber: o.order_number, status: o.status },
    ]),
  );
  const openOrderIds = Array.from(orderInfoById.keys());

  type PendingLine = {
    variantId: string | null;
    productTitle: string | null;
    variantTitle: string | null;
    qty: number;
  };
  type PendingBucket = {
    orderId: string;
    orderNumber: string;
    status: string;
    qty: number;
    lines: PendingLine[];
  };

  const pendingByVariant = new Map<string, number>();
  const pendingBreakdownMap = new Map<string, PendingBucket>();

  if (openOrderIds.length > 0 && filteredVariantIds.length > 0) {
    const { data: pendingItems } = await supabase
      .from('supplier_order_items')
      .select('variant_id, quantity, order_id, product_title, variant_title')
      .in('order_id', openOrderIds)
      .in('variant_id', filteredVariantIds);
    for (const it of pendingItems ?? []) {
      if (!it.variant_id) continue;
      const q = Number(it.quantity) || 0;
      pendingByVariant.set(it.variant_id, (pendingByVariant.get(it.variant_id) || 0) + q);
      const info = orderInfoById.get(it.order_id);
      if (!info) continue;
      const line: PendingLine = {
        variantId: it.variant_id,
        productTitle: it.product_title,
        variantTitle: it.variant_title,
        qty: q,
      };
      const existing = pendingBreakdownMap.get(it.order_id);
      if (existing) {
        existing.qty += q;
        existing.lines.push(line);
      } else {
        pendingBreakdownMap.set(it.order_id, {
          orderId: it.order_id,
          orderNumber: info.orderNumber,
          status: info.status,
          qty: q,
          lines: [line],
        });
      }
    }
  }
  const pendingBreakdown = Array.from(pendingBreakdownMap.values()).sort((a, b) =>
    a.orderNumber.localeCompare(b.orderNumber),
  );

  // Variantes non-Shopify (archived ou produit local) ne reçoivent pas de
  // suggestion : on ne peut commander chez le fournisseur que ce qui existe
  // sur Shopify. On zéro le soldInWindow pour le math, mais leur currentInBox
  // compte normalement pour le budget (elles prennent de la place dans la
  // caisse) et le total affiché dans le footer.
  const inputs: VariantInput[] = filteredVariants.map((v: any) => ({
    variantId: v.id,
    soldInWindow: v.shopify_active === true ? (soldByVariant.get(v.id) || 0) : 0,
    currentInBox: qtyByVariant.get(v.id) || 0,
  }));
  const suggestions = computeRefillSuggestions(inputs, type.max_capacity);
  const suggestionByVariant = new Map(suggestions.map((s) => [s.variantId, s]));

  const variantByProduct = new Map<string, any[]>();
  for (const v of filteredVariants) {
    // On masque les variantes non-Shopify dans la table — on ne peut pas les
    // commander chez le fournisseur. Elles restent comptées dans totalCurrent
    // et dans le budget (calculés au-dessus via inputs) pour que la jauge
    // "X / capacity" matche la card et que les suggestions ne dépassent
    // pas la place réelle dans la caisse.
    if (v.shopify_active !== true) continue;
    const p: any = productById.get(v.product_id);
    if (!p) continue;
    const color = extractByOptionName(v, p, COLOR_OPTION_NAMES);
    const size = extractByOptionName(v, p, SIZE_OPTION_NAMES);
    const sug = suggestionByVariant.get(v.id);
    const titleParts = [v.option1, v.option2, v.option3].filter(Boolean);
    const variantOut = {
      variantId: v.id,
      title: titleParts.join(' · ') || v.title || 'Default',
      sku: v.sku,
      color,
      colorHex: resolveHex(color),
      size,
      currentInBox: sug?.currentInBox ?? 0,
      currentAtLocation: sug?.currentInBox ?? 0,
      // Affiche les VRAIES sorties (pas la version zéro pour le math). Permet
      // au badge "5 / 30j" d'être informatif même sur les variantes non-Shopify.
      soldInWindow: soldByVariant.get(v.id) || 0,
      soldLifetime: lifetimeSoldByVariant.get(v.id) || 0,
      pendingInOrder: pendingByVariant.get(v.id) || 0,
      suggestedQty: sug?.suggestedQty ?? 0,
    };
    if (!variantByProduct.has(v.product_id)) variantByProduct.set(v.product_id, []);
    variantByProduct.get(v.product_id)!.push(variantOut);
  }

  const productsOut = products
    .map((p: any) => ({
      productId: p.id,
      title: p.title,
      variants: variantByProduct.get(p.id) || [],
    }))
    .filter((p: any) => p.variants.length > 0)
    .sort((a: any, b: any) => a.title.localeCompare(b.title));

  const totalCurrent = inputs.reduce((s, v) => s + v.currentInBox, 0);
  const totalPending = filteredVariants.reduce(
    (s: number, v: any) => s + (pendingByVariant.get(v.id) || 0),
    0,
  );
  const pct = type.max_capacity > 0
    ? Math.min(100, Math.round((totalCurrent / type.max_capacity) * 100))
    : 0;

  return NextResponse.json({
    containerId,
    containerName,
    capacity: { max: type.max_capacity, current: totalCurrent, pct, pending: totalPending },
    window: { type: windowType, label: windowLabel },
    pendingBreakdown,
    products: productsOut,
  });
}
