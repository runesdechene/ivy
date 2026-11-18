import { NextRequest, NextResponse } from 'next/server';

// Redirige vers Shopify pour l'autorisation OAuth
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const shop = searchParams.get('shop');

  if (!shop) {
    return NextResponse.json({ error: 'Missing shop parameter' }, { status: 400 });
  }

  // Credentials de l'app Ivy depuis le Dev Dashboard
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/shopify/callback`;
  // Alignés sur les droits réels de l'app (un droit write_ inclut le read_) : une réinstallation ne doit rien perdre.
  const scopes = 'read_orders,write_products,write_inventory,write_locations,read_metaobjects,write_metaobjects,write_files';

  if (!clientId) {
    return NextResponse.json({ error: 'Missing SHOPIFY_CLIENT_ID in env' }, { status: 500 });
  }

  // Construire l'URL d'autorisation Shopify
  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  return NextResponse.redirect(authUrl);
}
