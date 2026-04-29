import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

type VariantInfo = {
  id: string;
  title: string;
  color: string | null;
  color_hex: string | null;
  qty: number;
};

type InstanceResp = {
  id: string;
  type: {
    id: string;
    name: string;
    max_capacity: number;
    empty_weight_g: number | null;
    ratio_w: number;
    ratio_h: number;
  };
  products: { id: string; title: string; illustration_url: string | null }[];
  fill: { units: number; pct: number; weight_g: number | null };
  variants: VariantInfo[];
};

const COLOR_OPTION_NAMES = ['couleur', 'color', 'colour'];

function extractColor(
  variant: { option1?: string | null; option2?: string | null; option3?: string | null },
  product: { option1_name?: string | null; option2_name?: string | null; option3_name?: string | null },
): string | null {
  const slots: Array<[string | null | undefined, string | null | undefined]> = [
    [product.option1_name, variant.option1],
    [product.option2_name, variant.option2],
    [product.option3_name, variant.option3],
  ];
  for (const [name, value] of slots) {
    if (name && COLOR_OPTION_NAMES.includes(String(name).toLowerCase()) && value) {
      return value;
    }
  }
  return null;
}

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
      type:container_types(id, name, max_capacity, empty_weight_g, ratio_w, ratio_h),
      affectations:container_instance_products(
        product:products(id, title, illustration_url, option1_name, option2_name, option3_name)
      )
    `)
    .eq('shop_id', shopId)
    .eq('location_id', locationId)
    .order('position', { ascending: true });

  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  const result: InstanceResp[] = [];

  for (const inst of (instances ?? []) as any[]) {
    const products = (inst.affectations ?? [])
      .map((a: any) => a.product)
      .filter(Boolean);
    const productIds = products.map((p: any) => p.id);

    const variants: VariantInfo[] = [];
    let units = 0;

    if (productIds.length > 0) {
      const { data: prodWithVariants, error: vErr } = await supabase
        .from('products')
        .select(`
          id,
          option1_name,
          option2_name,
          option3_name,
          variants:product_variants(
            id,
            title,
            option1,
            option2,
            option3,
            inventory_levels(quantity, location_id)
          )
        `)
        .in('id', productIds);

      if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

      for (const p of (prodWithVariants ?? []) as any[]) {
        for (const v of (p.variants ?? []) as any[]) {
          const lvl = (v.inventory_levels ?? []).find(
            (l: any) => String(l.location_id) === String(locationId),
          );
          const qty = Math.max(0, lvl?.quantity ?? 0);
          if (qty <= 0) continue;
          const color = extractColor(v, p);
          variants.push({
            id: v.id,
            title: v.title,
            color,
            color_hex: resolveHex(color),
            qty,
          });
          units += qty;
        }
      }
    }

    const type = Array.isArray(inst.type) ? inst.type[0] : inst.type;
    const max = type?.max_capacity ?? 1;
    const pct = Math.min(100, Math.round((units / max) * 100));

    result.push({
      id: inst.id,
      type: {
        id: type.id,
        name: type.name,
        max_capacity: type.max_capacity,
        empty_weight_g: type.empty_weight_g,
        ratio_w: type.ratio_w,
        ratio_h: type.ratio_h,
      },
      products: products.map((p: any) => ({
        id: p.id,
        title: p.title,
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
