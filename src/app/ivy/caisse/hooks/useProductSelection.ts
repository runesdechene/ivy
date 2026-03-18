'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { SelectedProduct, VariantOption } from '../types';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Column keys: 'type', 'product', or 'opt:<OptionName>'
export type ColumnKey = string;

export interface ProductVariant {
  id: string;
  productId: string;
  shopifyId: string;
  title: string;
  sku: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  inventoryItemId: string | null;
  stock: number;
}

export interface ColumnValue {
  value: string;
  label: string;
  stock: number;
}

const SIZE_ORDER = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'];

function sortColumnValues(values: ColumnValue[], label: string): ColumnValue[] {
  const isSizeColumn = label.toLowerCase().includes('taille') || label.toLowerCase().includes('size');
  if (isSizeColumn) {
    return values.sort((a, b) => {
      const indexA = SIZE_ORDER.indexOf(a.label.toUpperCase());
      const indexB = SIZE_ORDER.indexOf(b.label.toUpperCase());
      if (indexA === -1 && indexB === -1) return a.label.localeCompare(b.label);
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });
  }
  return values.sort((a, b) => a.label.localeCompare(b.label));
}

interface UseProductSelectionReturn {
  columnOrder: ColumnKey[];
  setColumnOrder: (order: ColumnKey[]) => void;
  selections: Record<ColumnKey, string | null>;
  selectColumn: (key: ColumnKey, value: string) => void;
  getValuesForColumn: (key: ColumnKey) => ColumnValue[];
  getColumnLabel: (key: ColumnKey) => string;
  activeColumns: ColumnKey[];
  selectedVariant: VariantOption | null;
  selectedProduct: SelectedProduct | null;
  resetSelection: () => void;
  loading: boolean;
  refreshInventory: () => Promise<void>;
}

// Get the option value from a variant for a given option name
function getVariantValueByOptionName(
  variant: ProductVariant,
  product: SelectedProduct | undefined,
  optionName: string
): string | null {
  if (!product) return null;
  if (product.option1Name === optionName) return variant.option1;
  if (product.option2Name === optionName) return variant.option2;
  if (product.option3Name === optionName) return variant.option3;
  return null;
}

export function useProductSelection(
  shopId: string | undefined,
  locationId: string | undefined
): UseProductSelectionReturn {
  const [allProducts, setAllProducts] = useState<SelectedProduct[]>([]);
  const [allVariants, setAllVariants] = useState<ProductVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const shopIdRef = useRef(shopId);
  const locationIdRef = useRef(locationId);
  shopIdRef.current = shopId;
  locationIdRef.current = locationId;

  const [selections, setSelections] = useState<Record<ColumnKey, string | null>>({});
  const [columnOrder, setColumnOrderState] = useState<ColumnKey[]>([]);
  const [userColumnOrder, setUserColumnOrder] = useState<ColumnKey[] | null>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('hub_columnOrder_v2');
      if (saved) {
        try { return JSON.parse(saved); } catch { /* ignore */ }
      }
    }
    return null;
  });

  // Build product lookup
  const productById = useMemo(() => {
    const map = new Map<string, SelectedProduct>();
    allProducts.forEach(p => map.set(p.id, p));
    return map;
  }, [allProducts]);

  // Discover all unique option names across products
  const allOptionNames = useMemo((): string[] => {
    const names = new Set<string>();
    allProducts.forEach(p => {
      if (p.option1Name) names.add(p.option1Name);
      if (p.option2Name) names.add(p.option2Name);
      if (p.option3Name) names.add(p.option3Name);
    });
    return Array.from(names).sort();
  }, [allProducts]);

  // Build default column order: type, product, then each unique option name
  const defaultColumnOrder = useMemo((): ColumnKey[] => {
    return ['type', 'product', ...allOptionNames.map(n => `opt:${n}`)];
  }, [allOptionNames]);

  // Determine active column order (init only, no selection reset)
  const initDone = useRef(false);
  useEffect(() => {
    if (allOptionNames.length === 0) return;
    if (initDone.current) return;
    initDone.current = true;

    if (userColumnOrder) {
      const validKeys = new Set(defaultColumnOrder);
      const merged = userColumnOrder.filter(k => validKeys.has(k));
      const missing = defaultColumnOrder.filter(k => !merged.includes(k));
      setColumnOrderState(merged.concat(missing));
    } else {
      setColumnOrderState(defaultColumnOrder);
    }
  }, [defaultColumnOrder, userColumnOrder, allOptionNames]);

  // User-triggered reorder (resets selections)
  const setColumnOrder = useCallback((order: ColumnKey[]) => {
    setColumnOrderState(order);
    setUserColumnOrder(order);
    localStorage.setItem('hub_columnOrder_v2', JSON.stringify(order));
    setSelections({});
  }, []);

  // --- Data loading ---
  const loadData = useCallback(async () => {
    const sid = shopIdRef.current;
    const lid = locationIdRef.current;
    if (!sid) return;

    setLoading(true);
    try {
      const { data: products } = await supabase
        .from('products')
        .select(`
          id, shopify_id, title, product_type, option1_name, option2_name, option3_name,
          variants:product_variants(
            id, product_id, shopify_id, title, sku,
            option1, option2, option3,
            inventory_item_id,
            inventory_levels(quantity, location_id)
          )
        `)
        .eq('shop_id', sid)
        .in('status', ['active', 'local', 'draft']);

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

        const allVars: ProductVariant[] = [];
        for (const p of products) {
          for (const v of (p.variants as any[]) || []) {
            const levels = (v.inventory_levels as any[]) || [];
            const level = lid ? levels.find((il: any) => il.location_id === lid) : null;
            const stock = Math.max(0, level?.quantity || 0);
            allVars.push({
              id: v.id, productId: v.product_id, shopifyId: v.shopify_id,
              title: v.title, sku: v.sku,
              option1: v.option1, option2: v.option2, option3: v.option3,
              inventoryItemId: v.inventory_item_id, stock,
            });
          }
        }
        setAllVariants(allVars);
      }
    } catch (error) {
      console.error('Error loading products:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [shopId, locationId, loadData]);

  // --- Filter engine ---
  const filterVariants = useCallback((upToColumnKey: ColumnKey | null): ProductVariant[] => {
    let filtered = allVariants;

    for (const colKey of columnOrder) {
      if (colKey === upToColumnKey) break;

      const sel = selections[colKey];
      if (!sel) continue;

      if (colKey === 'type') {
        const productIds = new Set(
          allProducts.filter(p => p.productType === sel).map(p => p.id)
        );
        filtered = filtered.filter(v => productIds.has(v.productId));
      } else if (colKey === 'product') {
        filtered = filtered.filter(v => v.productId === sel);
      } else if (colKey.startsWith('opt:')) {
        const optionName = colKey.slice(4);
        filtered = filtered.filter(v => {
          const product = productById.get(v.productId);
          return getVariantValueByOptionName(v, product, optionName) === sel;
        });
      }
    }

    return filtered;
  }, [allVariants, allProducts, productById, columnOrder, selections]);

  // --- Column values ---
  const getValuesForColumn = useCallback((key: ColumnKey): ColumnValue[] => {
    const filtered = filterVariants(key);

    if (key === 'type') {
      const typeMap = new Map<string, number>();
      filtered.forEach(v => {
        const product = productById.get(v.productId);
        if (product) {
          typeMap.set(product.productType, (typeMap.get(product.productType) || 0) + v.stock);
        }
      });
      return Array.from(typeMap.entries())
        .map(([type, stock]) => ({ value: type, label: type, stock }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }

    if (key === 'product') {
      const productMap = new Map<string, number>();
      filtered.forEach(v => {
        productMap.set(v.productId, (productMap.get(v.productId) || 0) + v.stock);
      });
      return Array.from(productMap.entries())
        .map(([productId, stock]) => {
          const product = productById.get(productId);
          return { value: productId, label: product?.title || productId, stock };
        })
        .sort((a, b) => a.label.localeCompare(b.label));
    }

    if (key.startsWith('opt:')) {
      const optionName = key.slice(4);
      const valueMap = new Map<string, number>();
      filtered.forEach(v => {
        const product = productById.get(v.productId);
        const val = getVariantValueByOptionName(v, product, optionName);
        if (val) {
          valueMap.set(val, (valueMap.get(val) || 0) + v.stock);
        }
      });
      const values = Array.from(valueMap.entries())
        .map(([val, stock]) => ({ value: val, label: val, stock }));
      return sortColumnValues(values, optionName);
    }

    return [];
  }, [filterVariants, productById]);

  // --- Column labels ---
  const getColumnLabel = useCallback((key: ColumnKey): string => {
    if (key === 'type') return 'Type';
    if (key === 'product') return 'Produit';
    if (key.startsWith('opt:')) return key.slice(4);
    return key;
  }, []);

  // --- Active columns (hide option columns with zero variants) ---
  const activeColumns = useMemo((): ColumnKey[] => {
    return columnOrder.filter(key => {
      if (key === 'type' || key === 'product') return true;
      if (key.startsWith('opt:')) {
        const optionName = key.slice(4);
        return allVariants.some(v => {
          const product = productById.get(v.productId);
          return getVariantValueByOptionName(v, product, optionName) !== null;
        });
      }
      return false;
    });
  }, [columnOrder, allVariants, productById]);

  // --- Selected variant ---
  const selectedProduct = useMemo((): SelectedProduct | null => {
    if (!selections.product) return null;
    return productById.get(selections.product) || null;
  }, [selections.product, productById]);

  const selectedVariant = useMemo((): VariantOption | null => {
    // Must have type and product selected
    if (!selections.type || !selections.product) return null;

    const product = productById.get(selections.product);
    if (!product) return null;

    // Check that all option columns relevant to THIS product have a selection
    const productOptionNames: string[] = [];
    if (product.option1Name) productOptionNames.push(product.option1Name);
    if (product.option2Name) productOptionNames.push(product.option2Name);
    if (product.option3Name) productOptionNames.push(product.option3Name);

    for (const optName of productOptionNames) {
      if (!selections[`opt:${optName}`]) return null;
    }

    const filtered = filterVariants(null);
    if (filtered.length !== 1) return null;

    const v = filtered[0];
    return { value: v.title, stock: v.stock, variantId: v.id };
  }, [activeColumns, selections, filterVariants, productById]);

  // --- Selection ---
  const selectColumn = useCallback((key: ColumnKey, value: string) => {
    setSelections(prev => {
      const next = { ...prev, [key]: value };

      // Clear all selections AFTER this column in the current order
      const pos = columnOrder.indexOf(key);
      for (let i = pos + 1; i < columnOrder.length; i++) {
        next[columnOrder[i]] = null;
      }

      return next;
    });
  }, [columnOrder]);

  const resetSelection = useCallback(() => {
    setSelections({});
  }, []);

  return {
    columnOrder: columnOrder.length > 0 ? columnOrder : defaultColumnOrder,
    setColumnOrder,
    selections,
    selectColumn,
    getValuesForColumn,
    getColumnLabel,
    activeColumns: activeColumns.length > 0 ? activeColumns : defaultColumnOrder.slice(0, 2),
    selectedVariant,
    selectedProduct,
    resetSelection,
    loading,
    refreshInventory: loadData,
  };
}
