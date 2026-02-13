'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ProductSelection, SelectedProduct, VariantOption } from '../types';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface UseProductSelectionReturn {
  selection: ProductSelection;
  productTypes: VariantOption[];
  products: (SelectedProduct & { stock: number })[];
  colorOptions: VariantOption[];
  sizeOptions: VariantOption[];
  option3Options: VariantOption[];
  selectType: (type: string) => void;
  selectProduct: (product: SelectedProduct) => void;
  selectColor: (color: string) => void;
  selectSize: (size: string) => void;
  selectOption3: (option3: string) => void;
  resetSelection: () => void;
  selectedVariant: VariantOption | null;
  loading: boolean;
  refreshInventory: () => Promise<void>;
}

export function useProductSelection(
  shopId: string | undefined,
  locationId: string | undefined
): UseProductSelectionReturn {
  const [selection, setSelection] = useState<ProductSelection>({
    type: null,
    product: null,
    color: null,
    size: null,
    option3: null,
  });

  const [allProducts, setAllProducts] = useState<SelectedProduct[]>([]);
  const [allVariants, setAllVariants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const shopIdRef = useRef(shopId);
  const locationIdRef = useRef(locationId);
  shopIdRef.current = shopId;
  locationIdRef.current = locationId;

  const loadData = useCallback(async () => {
    const sid = shopIdRef.current;
    const lid = locationIdRef.current;
    if (!sid) return;

    setLoading(true);
    try {
      // Load products
      const { data: products } = await supabase
        .from('products')
        .select('id, shopify_id, title, product_type, option1_name, option2_name, option3_name')
        .eq('shop_id', sid)
        .eq('status', 'active');

      if (products) {
        setAllProducts(products.map(p => ({
          id: p.id,
          shopifyId: p.shopify_id,
          title: p.title,
          productType: p.product_type || 'Non défini',
          option1Name: p.option1_name,
          option2Name: p.option2_name,
          option3Name: p.option3_name,
        })));
      }

      // Attendre qu'un emplacement soit sélectionné avant de charger les stocks
      if (!lid) {
        setAllVariants([]);
        setLoading(false);
        return;
      }

      // Load variants with inventory levels (only active Shopify variants for this location)
      const { data: variants } = await supabase
        .from('product_variants')
        .select(`
          id,
          product_id,
          shopify_id,
          title,
          sku,
          option1,
          option2,
          option3,
          price,
          cost,
          inventory_item_id,
          inventory_levels!inner(quantity, location_id)
        `)
        .neq('shopify_active', false)
        .eq('inventory_levels.location_id', lid);

      if (variants) {
        setAllVariants(variants.map(v => ({
          id: v.id,
          productId: v.product_id,
          shopifyId: v.shopify_id,
          title: v.title,
          sku: v.sku,
          option1: v.option1,
          option2: v.option2,
          option3: v.option3,
          price: v.price || 0,
          cost: v.cost || 0,
          inventoryItemId: v.inventory_item_id,
          stock: v.inventory_levels?.reduce((sum: number, il: any) => sum + (il.quantity || 0), 0) || 0,
        })));
      }
    } catch (error) {
      console.error('Error loading products:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load products and variants
  useEffect(() => {
    loadData();
  }, [shopId, locationId, loadData]);

  // Get unique product types with stock count
  const productTypes = useMemo((): VariantOption[] => {
    const typeMap = new Map<string, number>();
    
    // Pour chaque produit, calculer le stock total de ses variantes
    allProducts.forEach(p => {
      const productVariants = allVariants.filter(v => v.productId === p.id);
      const productStock = productVariants.reduce((sum, v) => sum + v.stock, 0);
      const current = typeMap.get(p.productType) || 0;
      typeMap.set(p.productType, current + productStock);
    });

    return Array.from(typeMap.entries())
      .map(([value, stock]) => ({ value, stock }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [allProducts, allVariants]);

  // Get products filtered by selected type with stock count
  const products = useMemo((): (SelectedProduct & { stock: number })[] => {
    if (!selection.type) return [];
    return allProducts
      .filter(p => p.productType === selection.type)
      .map(p => {
        const productVariants = allVariants.filter(v => v.productId === p.id);
        const stock = productVariants.reduce((sum, v) => sum + v.stock, 0);
        return { ...p, stock };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [allProducts, allVariants, selection.type]);

  // Get variants for selected product
  const productVariants = useMemo(() => {
    if (!selection.product) return [];
    return allVariants.filter(v => v.productId === selection.product?.id);
  }, [allVariants, selection.product]);

  // Get color options (option1)
  const colorOptions = useMemo((): VariantOption[] => {
    if (!selection.product) return [];
    
    const colorMap = new Map<string, number>();
    productVariants.forEach(v => {
      if (v.option1) {
        const current = colorMap.get(v.option1) || 0;
        colorMap.set(v.option1, current + v.stock);
      }
    });

    return Array.from(colorMap.entries())
      .map(([value, stock]) => ({ value, stock }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [productVariants, selection.product]);

  // Get size options (option2) filtered by color
  const sizeOptions = useMemo((): VariantOption[] => {
    if (!selection.product || !selection.color) return [];
    
    const filtered = productVariants.filter(v => v.option1 === selection.color);
    const sizeMap = new Map<string, number>();
    
    filtered.forEach(v => {
      if (v.option2) {
        const current = sizeMap.get(v.option2) || 0;
        sizeMap.set(v.option2, current + v.stock);
      }
    });

    // Sort sizes
    const sizeOrder = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'];
    return Array.from(sizeMap.entries())
      .map(([value, stock]) => ({ value, stock }))
      .sort((a, b) => {
        const indexA = sizeOrder.indexOf(a.value.toUpperCase());
        const indexB = sizeOrder.indexOf(b.value.toUpperCase());
        if (indexA === -1 && indexB === -1) return a.value.localeCompare(b.value);
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
      });
  }, [productVariants, selection.product, selection.color]);

  // Get option3 options filtered by color and size
  const option3Options = useMemo((): VariantOption[] => {
    if (!selection.product || !selection.color || !selection.size) return [];
    if (!selection.product.option3Name) return [];
    
    const filtered = productVariants.filter(v => 
      v.option1 === selection.color && v.option2 === selection.size
    );
    
    const optionMap = new Map<string, { stock: number; variantId: string; price: number; cost: number }>();
    
    filtered.forEach(v => {
      if (v.option3) {
        optionMap.set(v.option3, {
          stock: v.stock,
          variantId: v.id,
          price: v.price,
          cost: v.cost,
        });
      }
    });

    return Array.from(optionMap.entries()).map(([value, data]) => ({
      value,
      stock: data.stock,
      variantId: data.variantId,
      price: data.price,
      cost: data.cost,
    }));
  }, [productVariants, selection.product, selection.color, selection.size]);

  // Get selected variant (when all options are selected)
  const selectedVariant = useMemo((): VariantOption | null => {
    if (!selection.product || !selection.color || !selection.size) return null;
    
    // If product has option3, we need that too
    if (selection.product.option3Name && !selection.option3) return null;

    const variant = productVariants.find(v => {
      if (v.option1 !== selection.color) return false;
      if (v.option2 !== selection.size) return false;
      if (selection.product?.option3Name && v.option3 !== selection.option3) return false;
      return true;
    });

    if (!variant) return null;

    return {
      value: variant.title,
      stock: variant.stock,
      variantId: variant.id,
      price: variant.price,
      cost: variant.cost,
    };
  }, [productVariants, selection]);

  const selectType = useCallback((type: string) => {
    setSelection({
      type,
      product: null,
      color: null,
      size: null,
      option3: null,
    });
  }, []);

  const selectProduct = useCallback((product: SelectedProduct) => {
    setSelection(prev => ({
      ...prev,
      product,
      color: null,
      size: null,
      option3: null,
    }));
  }, []);

  const selectColor = useCallback((color: string) => {
    setSelection(prev => ({
      ...prev,
      color,
      size: null,
      option3: null,
    }));
  }, []);

  const selectSize = useCallback((size: string) => {
    setSelection(prev => ({
      ...prev,
      size,
      option3: null,
    }));
  }, []);

  const selectOption3 = useCallback((option3: string) => {
    setSelection(prev => ({
      ...prev,
      option3,
    }));
  }, []);

  const resetSelection = useCallback(() => {
    setSelection({
      type: null,
      product: null,
      color: null,
      size: null,
      option3: null,
    });
  }, []);

  return {
    selection,
    productTypes,
    products,
    colorOptions,
    sizeOptions,
    option3Options,
    selectType,
    selectProduct,
    selectColor,
    selectSize,
    selectOption3,
    resetSelection,
    selectedVariant,
    loading,
    refreshInventory: loadData,
  };
}
