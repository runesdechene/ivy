import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';
import { parseOrigine, parseSh } from '@/lib/customs/tariffs';

const PAGE_SIZE = 1000;

/**
 * GET /api/settings/customs-tariffs?shopId= — le référentiel douanier, et TOUS les
 * types de produits de la boutique : un type doit pouvoir recevoir son code avant
 * même son premier voyage.
 */
export async function GET(request: NextRequest) {
  const shopId = request.nextUrl.searchParams.get('shopId');
  if (!shopId) return NextResponse.json({ error: 'Missing shopId' }, { status: 400 });

  const supabase = createServerClient();
  try {
    const { data: rows, error } = await supabase
      .from('customs_type_tariffs')
      .select('product_type, code_sh, libelle, origine, prix_affiche_chf, prix_minimal_chf, updated_at')
      .eq('shop_id', shopId);
    if (error) throw error;

    const types = new Set<string>();
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error: pErr } = await supabase
        .from('products')
        .select('product_type')
        .eq('shop_id', shopId)
        .not('product_type', 'is', null)
        .order('id')
        .range(from, from + PAGE_SIZE - 1);
      if (pErr) throw pErr;
      for (const p of (data ?? []) as { product_type: string }[]) {
        if (p.product_type.trim()) types.add(p.product_type);
      }
      if (!data || data.length < PAGE_SIZE) break;
    }
    // Un type saisi au référentiel mais disparu du catalogue reste visible.
    for (const r of rows ?? []) types.add(r.product_type);

    return NextResponse.json({ rows: rows ?? [], productTypes: [...types].sort((a, b) => a.localeCompare(b, 'fr')) });
  } catch (err) {
    console.error('GET /api/settings/customs-tariffs:', err);
    return NextResponse.json({ error: 'Lecture du référentiel impossible' }, { status: 500 });
  }
}

/**
 * PUT — enregistre le code SH, le libellé et l'origine d'un type.
 * body: { shopId, productType, codeSh, libelle, origine }. Un champ vide l'efface ;
 * un code SH sans ses 8 chiffres ou une origine sans ses 2 lettres est refusé,
 * plutôt que stocké faux.
 */
export async function PUT(request: NextRequest) {
  const body = (await request.json()) as {
    shopId?: string; productType?: string; codeSh?: string; libelle?: string; origine?: string;
    prixAffiche?: number | null; prixMinimal?: number | null;
  };
  const { shopId, productType } = body;
  if (!shopId || !productType) {
    return NextResponse.json({ error: 'shopId et productType requis' }, { status: 400 });
  }

  const saisie = (body.codeSh ?? '').trim();
  const codeSh = saisie ? parseSh(saisie) : null;
  if (saisie && !codeSh) {
    return NextResponse.json({ error: 'Le code SH doit compter 8 chiffres (ex. 6109.1000)' }, { status: 400 });
  }
  const saisieOrigine = (body.origine ?? '').trim();
  const origine = saisieOrigine ? parseOrigine(saisieOrigine) : null;
  if (saisieOrigine && !origine) {
    return NextResponse.json({ error: "L'origine est un code pays à 2 lettres (ex. BD)" }, { status: 400 });
  }

  // Prix de stand : envoyés seulement par qui les modifie ; absents, ils ne bougent pas.
  const prix: Record<string, number | null> = {};
  for (const [cle, colonne] of [['prixAffiche', 'prix_affiche_chf'], ['prixMinimal', 'prix_minimal_chf']] as const) {
    if (!(cle in body)) continue;
    const v = body[cle];
    if (v !== null && !(typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
      return NextResponse.json({ error: 'Prix invalide' }, { status: 400 });
    }
    prix[colonne] = v === null ? null : Math.round(v * 100) / 100;
  }
  if (prix.prix_affiche_chf === 0) {
    return NextResponse.json({ error: 'Le prix affiché doit être supérieur à 0' }, { status: 400 });
  }
  if (typeof prix.prix_affiche_chf === 'number' && typeof prix.prix_minimal_chf === 'number' && prix.prix_minimal_chf > prix.prix_affiche_chf) {
    return NextResponse.json({ error: 'Le prix minimal ne peut pas dépasser le prix affiché' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('customs_type_tariffs')
    .upsert(
      {
        shop_id: shopId,
        product_type: productType,
        code_sh: codeSh,
        libelle: (body.libelle ?? '').trim() || null,
        origine,
        ...prix,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_id,product_type' },
    )
    .select('product_type, code_sh, libelle, origine, prix_affiche_chf, prix_minimal_chf, updated_at')
    .single();

  if (error) {
    console.error('PUT /api/settings/customs-tariffs:', error);
    return NextResponse.json({ error: 'Enregistrement impossible' }, { status: 500 });
  }
  return NextResponse.json({ row: data });
}
