import { NextRequest, NextResponse } from 'next/server';
import { autoriser, erreur, toutesLesLignes } from '@/lib/mockups/serveur';
import { boutique, shopifyGraphql } from '@/lib/mockups/shopify';
import { METACHAMPS, MIXTE, lireImpression, lireTaille, tailleVetement, type TailleImpression } from '@/lib/mockups/regles';

/**
 * Les métachamps d'impression de chaque produit × couleur, et leur écriture par lot sur Shopify.
 * Toutes les clés existantes sont en `custom` / `single_line_text_field` : on écrit de même.
 */

export const maxDuration = 26;
const PAQUET = 25; // limite de metafieldsSet
const ECRITURES_MAX = 200; // par requête : le client découpe les gros lots pour tenir dans le temps imparti

export type Cle = keyof typeof METACHAMPS;
export interface LigneImpression {
  productId: string; titre: string; modele: string | null; couleur: string;
  variantes: { id: string; taille: string | null }[]; // taille du vêtement, écriture unique (`tailleVetement`)
  recto: string | null; verso: string | null;
  tailles: Record<string, TailleImpression>; // taille du vêtement → taille d'impression
}
export interface Ecriture { variantId: string; cle: Cle; valeur: string }

interface LigneVariante {
  id: string; sku: string | null; option1: string | null; option2: string | null;
  products: { id: string; title: string }; variant_metafields: { key: string; value: string }[];
}

/** La valeur commune d'une liste, `MIXTE` si elles diffèrent. */
function commune(valeurs: (string | null)[]): string | null {
  const distinctes = [...new Set(valeurs)];
  return distinctes.length === 1 ? distinctes[0] : MIXTE;
}

/** `D-MAX` → `D-Max`, l'écriture déjà en place sur Shopify. */
function tailleShopify(t: TailleImpression): string {
  const [lettre, mot] = t.split('-');
  return `${lettre}-${mot[0]}${mot.slice(1).toLowerCase()}`;
}

export async function GET(request: NextRequest) {
  const acces = await autoriser(request, request.nextUrl.searchParams.get('shopId'));
  if (!acces.ok) return acces.reponse;
  const { svc } = acces.auth;

  try {
    const variantes = await toutesLesLignes<LigneVariante>((de, a) => svc.from('product_variants')
      .select('id, sku, option1, option2, products!inner(id, title, shop_id, status), variant_metafields(key, value)')
      .eq('products.shop_id', acces.shopId).eq('products.status', 'active').eq('shopify_active', true)
      .in('variant_metafields.key', Object.values(METACHAMPS))
      .order('id').range(de, a).returns<LigneVariante[]>());

    const groupes = new Map<string, LigneVariante[]>();
    for (const v of variantes) {
      const cle = `${v.products.id}|${v.option1 ?? ''}`;
      groupes.set(cle, [...(groupes.get(cle) ?? []), v]);
    }

    const lignes: LigneImpression[] = [...groupes.values()].map((vs) => {
      const mf = (v: LigneVariante, cle: string) => v.variant_metafields.find((m) => m.key === cle)?.value ?? null;
      const tailles: Record<string, TailleImpression> = {};
      for (const v of vs) {
        const t = lireTaille(mf(v, METACHAMPS.taille));
        if (v.option2 && t) tailles[tailleVetement(v.option2)] = t;
      }
      return {
        productId: vs[0].products.id, titre: vs[0].products.title,
        modele: vs.find((v) => v.sku?.trim())?.sku?.trim() ?? null, couleur: vs[0].option1 ?? '',
        variantes: vs.map((v) => ({ id: v.id, taille: v.option2 && tailleVetement(v.option2) })),
        recto: commune(vs.map((v) => mf(v, METACHAMPS.recto))),
        verso: commune(vs.map((v) => mf(v, METACHAMPS.verso))),
        tailles,
      };
    }).sort((a, b) => a.titre.localeCompare(b.titre, 'fr') || a.couleur.localeCompare(b.couleur, 'fr'));

    // Les valeurs déjà en place, proposées dans la barre d'action.
    const valeurs = (face: 'recto' | 'verso') => [...new Set(variantes.flatMap((v) =>
      v.variant_metafields.filter((m) => m.key === METACHAMPS[face]).map((m) => m.value)))].sort();
    return NextResponse.json({ lignes, valeurs: { recto: valeurs('recto'), verso: valeurs('verso') } });
  } catch (e) {
    return erreur((e as Error).message, 500);
  }
}

/** Écrit un lot de métachamps sur Shopify, par paquets de 25, puis dans IVY. Un paquet en échec n'arrête pas les suivants. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { shopId?: string; ecritures?: Ecriture[] } | null;
  const acces = await autoriser(request, body?.shopId);
  if (!acces.ok) return acces.reponse;
  const { svc } = acces.auth;

  const ecritures = body?.ecritures ?? [];
  if (!Array.isArray(ecritures) || ecritures.length === 0 || ecritures.length > ECRITURES_MAX) {
    return erreur(`Entre 1 et ${ECRITURES_MAX} écritures par envoi`);
  }
  // Valeur validée, puis mise au format Shopify.
  const valides: { variantId: string; key: string; value: string }[] = [];
  for (const e of ecritures) {
    if (typeof e?.variantId !== 'string' || !(e.cle in METACHAMPS) || typeof e.valeur !== 'string') return erreur('Écriture mal formée');
    if (e.cle === 'taille') {
      const t = lireTaille(e.valeur);
      if (!t) return erreur(`Taille d’impression inconnue : ${e.valeur}`);
      valides.push({ variantId: e.variantId, key: METACHAMPS.taille, value: tailleShopify(t) });
    } else {
      if (!lireImpression(e.valeur, e.cle)) return erreur(`Valeur illisible pour le ${e.cle} : ${e.valeur}`);
      valides.push({ variantId: e.variantId, key: METACHAMPS[e.cle], value: e.valeur.trim().toUpperCase() });
    }
  }

  try {
    // Les variantes doivent appartenir à la boutique.
    const ids = [...new Set(valides.map((e) => e.variantId))];
    const { data: connues, error } = await svc.from('product_variants').select('id, shopify_id, products!inner(shop_id)')
      .eq('products.shop_id', acces.shopId).in('id', ids);
    if (error) throw new Error(error.message);
    const shopifyId = new Map((connues ?? []).map((v) => [v.id, v.shopify_id as string]));
    if (shopifyId.size !== ids.length) return erreur('Variante inconnue de cette boutique', 403);

    const shop = await boutique(svc, acces.shopId);
    let modifiees = 0;
    const erreurs: string[] = [];
    for (let i = 0; i < valides.length; i += PAQUET) {
      const paquet = valides.slice(i, i + PAQUET);
      try {
        await shopifyGraphql(shop, `mutation($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) { userErrors { message } }
        }`, {
          metafields: paquet.map((e) => ({
            ownerId: `gid://shopify/ProductVariant/${shopifyId.get(e.variantId)}`,
            namespace: 'custom', key: e.key, type: 'single_line_text_field', value: e.value,
          })),
        });
        const maintenant = new Date().toISOString();
        const { error: e2 } = await svc.from('variant_metafields').upsert(paquet.map((e) => ({
          variant_id: e.variantId, namespace: 'custom', key: e.key, value: e.value,
          type: 'single_line_text_field', synced_at: maintenant, updated_at: maintenant,
        })), { onConflict: 'variant_id,namespace,key' });
        if (e2) erreurs.push(`Écrit sur Shopify mais pas dans IVY : ${e2.message}`);
        modifiees += paquet.length;
      } catch (e) {
        erreurs.push((e as Error).message);
      }
    }
    return NextResponse.json({ modifiees, erreurs });
  } catch (e) {
    return erreur((e as Error).message, 500);
  }
}
