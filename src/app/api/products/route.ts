import { NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');
    const locationId = searchParams.get('locationId');
    const search = searchParams.get('search');

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

    // Si recherche spécifiée, filtrer par titre et SKU
    if (search && search.length >= 3) {
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
            shopify_active
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
      // Pas de recherche - récupérer tous les produits avec inventaire (pour la page inventaire)
      const { data: allProducts, error: productsError } = await supabase
        .from('products')
        .select(`
          id,
          shopify_id,
          title,
          handle,
          image_url,
          status,
          product_type,
          synced_at,
          variants:product_variants(
            id,
            shopify_id,
            title,
            sku,
            option1,
            option2,
            option3,
            cost,
            shopify_active,
            inventory_levels(
              quantity,
              location_id
            )
          )
        `)
        .eq('shop_id', shopId)
        .eq('status', 'active')
        .order('title');
      
      if (productsError) {
        console.error('Error fetching products:', productsError);
      }
      
      productsByTitle = allProducts || [];
      
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
              option3: v.option3
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
              option3: v.option3
            });
          }
        }
      });
    }
    
    // Essayer de récupérer les noms d'options (colonnes optionnelles)
    let optionNamesMap: Record<string, { option1_name?: string; option2_name?: string; option3_name?: string }> = {};
    try {
      const { data: optionNamesData } = await supabase
        .from('products')
        .select('shopify_id, option1_name, option2_name, option3_name')
        .eq('shop_id', shopId);
      
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
          shopifyActive: variant.shopify_active ?? true,
          options: [
            variant.option1 && { name: optionNames?.option1_name || 'Option 1', value: variant.option1 },
            variant.option2 && { name: optionNames?.option2_name || 'Option 2', value: variant.option2 },
            variant.option3 && { name: optionNames?.option3_name || 'Option 3', value: variant.option3 },
          ].filter(Boolean),
          metafields: variant.metafields || [],
        };
      });

      // Calculer le total
      const totalQuantity = variants.reduce((sum: number, v: any) => sum + v.quantity, 0);

      // Grouper par taille
      const sizeBreakdown: Record<string, number> = {};
      variants.forEach((v: any) => {
        if (v.size) {
          sizeBreakdown[v.size] = (sizeBreakdown[v.size] || 0) + v.quantity;
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
