import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildCustomsDeclaration } from '@/lib/customs/declaration';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * Déclaration douanière suisse — document HTML prêt à imprimer.
 *
 * LECTURE SEULE : n'écrit rien, ni dans Ivy ni chez Shopify. On peut la
 * régénérer autant de fois qu'on veut.
 *
 * GET /api/customs/declaration?shopId=&locationId=&rate=0.94&gross=180&ref=1187-42
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const shopId = sp.get('shopId');
  const locationId = sp.get('locationId');
  const rate = Number(sp.get('rate'));
  const grossRaw = sp.get('gross');
  const reference = sp.get('ref') ?? '';
  const origin = sp.get('origin') || 'BD';
  // Majoration appliquee aux prix pour la vente en Suisse, et TVA suisse a deduire
  // pour obtenir une valeur douaniere hors taxe. 8.1 % est le taux normal en 2026.
  const markupPct = Number(sp.get('markup') ?? 0) || 0;
  const vatPct = sp.get('vat') !== null ? Number(sp.get('vat')) : 8.1;

  if (!shopId || !locationId) {
    return NextResponse.json({ error: 'shopId et locationId requis' }, { status: 400 });
  }
  if (!rate || rate <= 0) {
    return NextResponse.json({ error: 'Le taux EUR vers CHF est obligatoire' }, { status: 400 });
  }

  const grossKg = grossRaw && Number(grossRaw) > 0 ? Number(grossRaw) : null;

  try {
    const result = await buildCustomsDeclaration(supabase, shopId, locationId, {
      rate,
      grossKg,
      reference,
      origin,
      markupPct,
      vatPct: Number.isFinite(vatPct) ? vatPct : 8.1,
    });

    return new NextResponse(result.html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Pas de cache : le stock bouge, le document doit toujours être frais.
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('GET /api/customs/declaration:', error);
    const message = error instanceof Error ? error.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
