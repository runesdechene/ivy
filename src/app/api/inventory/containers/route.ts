import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

type VariantInfo = {
  id: string;
  title: string;
  color: string | null;
  color_hex: string | null;
  size: string | null;
  qty: number;
};

type ProductInfo = {
  id: string;
  title: string;
  image_url: string | null;
  illustration_url: string | null;
};

type InstanceResp = {
  id: string;
  name: string | null;
  filter_product_type: string | null;
  filter_size: string | null;
  type: {
    id: string;
    name: string;
    max_capacity: number;
    empty_weight_g: number | null;
    ratio_w: number;
    ratio_h: number;
    columns: number;
  };
  products: ProductInfo[];
  fill: { units: number; pct: number; weight_g: number | null };
  variants: VariantInfo[];
};

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

const extractColor = (v: any, p: any) => extractByOptionName(v, p, COLOR_OPTION_NAMES);
const extractSize = (v: any, p: any) => extractByOptionName(v, p, SIZE_OPTION_NAMES);

export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get('shopId');
  const locationId = req.nextUrl.searchParams.get('locationId');
  if (!shopId || !locationId) {
    return NextResponse.json({ error: 'shopId & locationId required' }, { status: 400 });
  }

  const supabase = createServerClient();

  // Précharger les color_rules de la boutique pour résoudre les hex
  const { data: colorRules } = await supabase
    .from('color_rules')
    .select('reception_name, hex_value')
    .eq('shop_id', shopId);

  const colorHexMap = new Map<string, string>();
  for (const r of colorRules ?? []) {
    if (r.reception_name) {
      colorHexMap.set(String(r.reception_name).toLowerCase().trim(), r.hex_value || '');
    }
  }
  const resolveHex = (color: string | null): string | null => {
    if (!color) return null;
    return colorHexMap.get(color.toLowerCase().trim()) || null;
  };

  const { data: instances, error: iErr } = await supabase
    .from('container_instances')
    .select(`
      id,
      name,
      filter_product_type,
      filter_size,
      type:container_types(id, name, max_capacity, empty_weight_g, ratio_w, ratio_h, columns),
      affectations:container_instance_products(
        product:products(id, title, image_url, illustration_url, option1_name, option2_name, option3_name)
      )
    `)
    .eq('shop_id', shopId)
    .eq('location_id', locationId)
    .order('position', { ascending: true });

  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  const result: InstanceResp[] = [];

  for (const inst of (instances ?? []) as any[]) {
    const isFilterMode = !!(inst.filter_product_type || inst.filter_size);

    // 1) Résoudre la liste des produits candidats selon le mode
    let resolvedProducts: any[] = [];
    if (isFilterMode) {
      let q = supabase
        .from('products')
        .select(`
          id, title, image_url, illustration_url,
          option1_name, option2_name, option3_name
        `)
        .eq('shop_id', shopId);
      if (inst.filter_product_type) {
        q = q.eq('product_type', inst.filter_product_type);
      }
      const { data, error } = await q;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      resolvedProducts = data ?? [];
    } else {
      resolvedProducts = (inst.affectations ?? [])
        .map((a: any) => a.product)
        .filter(Boolean);
    }

    const productIds = resolvedProducts.map((p: any) => p.id);
    const productById = new Map(resolvedProducts.map((p: any) => [p.id, p]));

    const variants: VariantInfo[] = [];
    const productIdsWithStock = new Set<string>();
    let units = 0;

    if (productIds.length > 0) {
      const { data: variantsRaw, error: vErr } = await supabase
        .from('product_variants')
        .select(`
          id,
          title,
          option1,
          option2,
          option3,
          product_id,
          inventory_levels(quantity, location_id)
        `)
        .in('product_id', productIds);

      if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

      for (const v of (variantsRaw ?? []) as any[]) {
        const p: any = productById.get(v.product_id);
        if (!p) continue;
        const lvl = (v.inventory_levels ?? []).find(
          (l: any) => String(l.location_id) === String(locationId),
        );
        const qty = Math.max(0, lvl?.quantity ?? 0);
        if (qty <= 0) continue;
        const size = extractSize(v, p);
        // En mode filtre avec filter_size renseigné, on ne garde que les
        // variants dont la taille extraite matche.
        if (isFilterMode && inst.filter_size && size !== inst.filter_size) continue;
        const color = extractColor(v, p);
        variants.push({
          id: v.id,
          title: v.title,
          color,
          color_hex: resolveHex(color),
          size,
          qty,
        });
        productIdsWithStock.add(v.product_id);
        units += qty;
      }
    }

    const type = Array.isArray(inst.type) ? inst.type[0] : inst.type;
    const max = type?.max_capacity ?? 1;
    const pct = Math.min(100, Math.round((units / max) * 100));

    // En mode filtre on n'affiche dans products[] que ceux qui ont effectivement
    // contribué des variants (sinon une caisse "size=M" listerait tous les produits
    // du shop, y compris ceux sans variant M en stock).
    const productsToShow = isFilterMode
      ? resolvedProducts.filter((p: any) => productIdsWithStock.has(p.id))
      : resolvedProducts;

    result.push({
      id: inst.id,
      name: inst.name ?? null,
      filter_product_type: inst.filter_product_type ?? null,
      filter_size: inst.filter_size ?? null,
      type: {
        id: type.id,
        name: type.name,
        max_capacity: type.max_capacity,
        empty_weight_g: type.empty_weight_g,
        ratio_w: type.ratio_w,
        ratio_h: type.ratio_h,
        columns: type.columns ?? 1,
      },
      products: productsToShow.map((p: any) => ({
        id: p.id,
        title: p.title,
        image_url: p.image_url ?? null,
        illustration_url: p.illustration_url ?? null,
      })),
      fill: { units, pct, weight_g: null },
      variants,
    });
  }

  return NextResponse.json({ instances: result });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { shop_id, container_type_id, location_id, position } = body;
  if (!shop_id || !container_type_id || !location_id) {
    return NextResponse.json({ error: 'shop_id, container_type_id, location_id required' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('container_instances')
    .insert({
      shop_id,
      container_type_id,
      location_id: String(location_id),
      position: position ?? 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ instance: data });
}
