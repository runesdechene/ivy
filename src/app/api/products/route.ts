import { NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');
    const locationId = searchParams.get('locationId');
    const search = searchParams.get('search');
    // Clé d'un produit unique (= clé d'URL `produit` : id Supabase ou handle). Permet de
    // charger UNE fiche directement au reload, sans rapatrier tout le catalogue.
    const productId = searchParams.get('productId');

    if (!shopId) {
      return NextResponse.json(
        { error: 'Shop ID is required' },
        { status: 400 }
      );
    }

    let supabase;
    try {
      supabase = createServerClient();
    } catch (e) {
      console.error('Error creating Supabase client:', e);
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    let productsByTitle: any[] = [];
    let variantsBySku: any[] = [];

    // Noms d'options : lancé tout de suite (le .then démarre la requête) pour qu'il tourne
    // EN PARALLÈLE de la requête produits au lieu d'ajouter un aller-retour en série.
    const optionNamesPromise = supabase
      .from('products')
      .select('shopify_id, option1_name, option2_name, option3_name')
      .eq('shop_id', shopId)
      .then((r) => r);

    // Select produits (variantes + compte métachamps). Niveaux de stock embarqués seulement
    // si aucun emplacement (fallback "somme tous emplacements") ; sinon attachés via requête
    // plate filtrée par emplacement. withMfCount = agrégat variant_metafields(count).
    const buildSelect = (withMfCount: boolean) => `
          id,
          shopify_id,
          title,
          handle,
          image_url,
          status,
          product_type,
          synced_at,
          created_at,
          variants:product_variants(
            id,
            shopify_id,
            title,
            sku,
            option1,
            option2,
            option3,
            cost,
            price,
            shopify_active${locationId ? '' : `,
            inventory_levels(quantity, location_id)`}${withMfCount ? `,
            variant_metafields(count)` : ''}
          )
        `;

    const runProducts = (withMfCount: boolean) =>
      supabase
        .from('products')
        .select(buildSelect(withMfCount))
        .eq('shop_id', shopId)
        .in('status', ['active', 'local', 'draft'])
        .order('title');

    // Rattache les niveaux de stock de l'emplacement demandé à un lot de produits, en
    // reconstruisant la forme attendue par le transform (inventory_levels: [{quantity, location_id}]).
    const attachLevels = async (products: any[]) => {
      if (!locationId || products.length === 0) return;
      const variantIds: string[] = [];
      for (const p of products) for (const v of p.variants || []) variantIds.push(v.id);
      if (variantIds.length === 0) return;
      let query = supabase
        .from('inventory_levels')
        .select('variant_id, quantity')
        .eq('location_id', locationId);
      // Petit lot (une fiche) → filtrer par variantes (requête minuscule). Catalogue complet
      // (milliers de variantes) → un IN ferait exploser l'URL : on prend tout l'emplacement.
      if (variantIds.length <= 200) query = query.in('variant_id', variantIds);
      const { data: levels } = await query;
      const levelByVariant = new Map<string, number>();
      for (const l of (levels as any[]) || []) levelByVariant.set(l.variant_id, l.quantity);
      for (const p of products) {
        for (const v of p.variants || []) {
          const q = levelByVariant.get(v.id);
          v.inventory_levels = q === undefined ? [] : [{ quantity: q, location_id: locationId }];
        }
      }
    };

    // Si recherche spécifiée, filtrer par titre et SKU
    if (productId) {
      // UNE fiche : on charge uniquement ce produit (id Supabase ou handle).
      const isUuid = /^[0-9a-fA-F-]{36}$/.test(productId);
      const singleQuery = (withMfCount: boolean) => {
        const q = supabase.from('products').select(buildSelect(withMfCount)).eq('shop_id', shopId);
        return isUuid ? q.eq('id', productId) : q.eq('handle', productId);
      };
      let res = await singleQuery(true);
      if (res.error) {
        console.warn('metafields(count) indisponible (single), fallback:', res.error.message);
        res = await singleQuery(false);
      }
      const product = (res.data as any[])?.[0];
      if (product) await attachLevels([product]);
      productsByTitle = product ? [product] : [];
    } else if (search && search.length >= 3) {
      const searchPattern = `%${search}%`;
      
      // Chercher les produits par titre
      const { data: titleResults } = await supabase
        .from('products')
        .select(`
          id,
          shopify_id,
          title,
          handle,
          image_url,
          status,
          synced_at,
          variants:product_variants(
            id,
            shopify_id,
            title,
            sku,
            option1,
            option2,
            option3,
            shopify_active,
            inventory_levels(
              quantity,
              location_id
            )
          )
        `)
        .eq('shop_id', shopId)
        .eq('status', 'active')
        .ilike('title', searchPattern)
        .limit(20);
      
      productsByTitle = titleResults || [];

      // Chercher les variantes par SKU
      const { data: skuResults } = await supabase
        .from('product_variants')
        .select(`
          id,
          shopify_id,
          title,
          sku,
          option1,
          option2,
          option3,
          inventory_levels(
            quantity,
            location_id
          ),
          product:products!inner(
            id,
            shopify_id,
            title,
            handle,
            image_url,
            status,
            synced_at,
            shop_id
          )
        `)
        .eq('product.shop_id', shopId)
        .eq('product.status', 'active')
        .ilike('sku', searchPattern)
        .limit(50);
      
      variantsBySku = skuResults || [];
    } else {
      // Page inventaire : tout le catalogue. Niveaux filtrés par emplacement (attachLevels)
      // et compte de métachamps via agrégat imbriqué (cf. buildSelect). Fallback sans compte
      // si les agrégats sont désactivés (la page charge, seuls les badges métachamps manquent).
      let productsRes = await runProducts(true);
      if (productsRes.error) {
        console.warn('metafields(count) indisponible, fallback sans compte:', productsRes.error.message);
        productsRes = await runProducts(false);
      }
      const allProducts = (productsRes.data as any[]) || [];
      await attachLevels(allProducts);
      productsByTitle = allProducts;
    }

    // Combiner les résultats
    const productIds = new Set<string>();
    const productsData: any[] = [];

    // Ajouter les produits trouvés par titre
    if (productsByTitle) {
      productsByTitle.forEach(p => {
        if (!productIds.has(p.id)) {
          productIds.add(p.id);
          productsData.push(p);
        }
      });
    }

    // Ajouter les produits trouvés via SKU de variante
    if (variantsBySku) {
      variantsBySku.forEach((v: any) => {
        const product = v.product;
        if (product && !productIds.has(product.id)) {
          productIds.add(product.id);
          // Récupérer toutes les variantes de ce produit
          productsData.push({
            ...product,
            variants: [{
              id: v.id,
              supabase_id: v.id,
              shopify_id: v.shopify_id,
              title: v.title,
              sku: v.sku,
              option1: v.option1,
              option2: v.option2,
              option3: v.option3,
              inventory_levels: v.inventory_levels
            }]
          });
        } else if (product) {
          // Ajouter la variante au produit existant
          const existingProduct = productsData.find(p => p.id === product.id);
          if (existingProduct && !existingProduct.variants.some((ev: any) => ev.id === v.id)) {
            existingProduct.variants.push({
              id: v.id,
              supabase_id: v.id,
              shopify_id: v.shopify_id,
              title: v.title,
              sku: v.sku,
              option1: v.option1,
              option2: v.option2,
              option3: v.option3,
              inventory_levels: v.inventory_levels
            });
          }
        }
      });
    }
    
    // Noms d'options (lancés en parallèle plus haut). Colonnes optionnelles → try/catch.
    const optionNamesMap: Record<string, { option1_name?: string; option2_name?: string; option3_name?: string }> = {};
    try {
      const { data: optionNamesData } = await optionNamesPromise;

      if (optionNamesData) {
        optionNamesData.forEach((p: any) => {
          optionNamesMap[p.shopify_id] = {
            option1_name: p.option1_name,
            option2_name: p.option2_name,
            option3_name: p.option3_name,
          };
        });
      }
    } catch (e) {
      // Les colonnes n'existent pas encore, on continue sans
      console.log('Option names columns not available yet');
    }

    // Si pas de produits, retourner un tableau vide avec un flag indiquant qu'il faut synchroniser
    if (!productsData || productsData.length === 0) {
      return NextResponse.json({ 
        products: [], 
        needsSync: true,
        message: 'Aucun produit en cache. Veuillez synchroniser depuis Shopify.'
      });
    }

    // Transformer les données pour le frontend
    const products = productsData.map((product: any) => {
      // Récupérer les noms d'options pour ce produit
      const optionNames = optionNamesMap[product.shopify_id] || {};
      
      const variants = product.variants.map((variant: any) => {
        // Déterminer la taille (option1 est généralement la taille)
        const size = variant.option1;

        // Calculer la quantité depuis inventory_levels
        let quantity = 0;
        if (variant.inventory_levels && Array.isArray(variant.inventory_levels)) {
          if (locationId) {
            // Filtrer par emplacement si spécifié
            const level = variant.inventory_levels.find((l: any) => l.location_id === locationId);
            quantity = level?.quantity || 0;
          } else {
            // Sinon, sommer tous les emplacements
            quantity = variant.inventory_levels.reduce((sum: number, l: any) => sum + (l.quantity || 0), 0);
          }
        }

        return {
          id: `gid://shopify/ProductVariant/${variant.shopify_id}`,
          supabaseId: variant.id,
          title: variant.title,
          sku: variant.sku,
          quantity,
          size,
          cost: variant.cost || 0,
          price: variant.price || 0,
          shopifyActive: (product.status === 'local' || product.status === 'draft') ? false : (variant.shopify_active ?? true),
          options: [
            variant.option1 && { name: optionNames?.option1_name || 'Option 1', value: variant.option1 },
            variant.option2 && { name: optionNames?.option2_name || 'Option 2', value: variant.option2 },
            variant.option3 && { name: optionNames?.option3_name || 'Option 3', value: variant.option3 },
          ].filter(Boolean),
          // Liste : on n'envoie que le NOMBRE de métachamps (badge), via l'agrégat imbriqué.
          // Les valeurs sont chargées à l'ouverture de la fiche via /api/products/metafields.
          metafieldsCount: variant.variant_metafields?.[0]?.count ?? 0,
        };
      });

      // Calculer le total (les négatifs sont clampés à 0 — faux négatifs Shopify)
      const totalQuantity = variants.reduce((sum: number, v: any) => sum + Math.max(0, v.quantity), 0);

      // Grouper par taille (idem, clamper les négatifs)
      const sizeBreakdown: Record<string, number> = {};
      variants.forEach((v: any) => {
        if (v.size) {
          sizeBreakdown[v.size] = (sizeBreakdown[v.size] || 0) + Math.max(0, v.quantity);
        }
      });

      // Calculer la tranche de coût
      const costs = variants.map((v: any) => v.cost || 0);
      const costRange = costs.length > 0 
        ? { min: Math.min(...costs), max: Math.max(...costs) }
        : undefined;

      return {
        id: `gid://shopify/Product/${product.shopify_id}`,
        supabaseId: product.id,
        title: product.title,
        handle: product.handle,
        status: product.status?.toUpperCase() || 'ACTIVE',
        image: product.image_url,
        imageAlt: product.title,
        productType: product.product_type || null,
        totalQuantity,
        sizeBreakdown,
        costRange,
        variants,
        syncedAt: product.synced_at,
        createdAt: product.created_at,
      };
    });

    return NextResponse.json({ products, needsSync: false });
  } catch (error) {
    console.error('Error fetching products:', error);
    return NextResponse.json(
      { error: 'Failed to fetch products' },
      { status: 500 }
    );
  }
}
