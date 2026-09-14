import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';
import { validerCaisses, validerMateriel } from '@/lib/customs/materiel';

/** GET ?shopId&locationId — le modèle douanier d'un emplacement, ou null s'il n'existe pas encore. */
export async function GET(request: NextRequest) {
  const shopId = request.nextUrl.searchParams.get('shopId');
  const locationId = request.nextUrl.searchParams.get('locationId');
  if (!shopId || !locationId) {
    return NextResponse.json({ error: 'shopId et locationId requis' }, { status: 400 });
  }
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('customs_location_templates')
    .select('packaging_kg, materiel, updated_at')
    .eq('shop_id', shopId)
    .eq('location_id', locationId)
    .maybeSingle();
  if (error) {
    console.error('GET /api/settings/customs-templates:', error);
    return NextResponse.json({ error: 'Lecture du modèle impossible' }, { status: 500 });
  }
  return NextResponse.json({ template: data });
}

/** PUT — enregistre le modèle entier. Une ligne fausse refuse tout l'envoi. */
export async function PUT(request: NextRequest) {
  const body = (await request.json()) as {
    shopId?: string; locationId?: string; packagingKg?: unknown; materiel?: unknown;
  };
  if (!body.shopId || !body.locationId) {
    return NextResponse.json({ error: 'shopId et locationId requis' }, { status: 400 });
  }
  const caisses = validerCaisses(body.packagingKg ?? {});
  if (!caisses) return NextResponse.json({ error: 'Poids de caisses invalide' }, { status: 400 });
  const materiel = validerMateriel(body.materiel ?? []);
  if ('erreur' in materiel) return NextResponse.json({ error: materiel.erreur }, { status: 400 });

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('customs_location_templates')
    .upsert(
      {
        shop_id: body.shopId,
        location_id: body.locationId,
        packaging_kg: caisses,
        materiel: materiel.materiel,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_id,location_id' },
    )
    .select('packaging_kg, materiel, updated_at')
    .single();
  if (error) {
    console.error('PUT /api/settings/customs-templates:', error);
    return NextResponse.json({ error: 'Enregistrement impossible' }, { status: 500 });
  }
  return NextResponse.json({ template: data });
}
