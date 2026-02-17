'use client';

import { Checkbox } from '@mantine/core';
import { useEffect, useState } from 'react';
import { supabase } from '@/supabase/client';
import { useShop } from '@/context/ShopContext';
import { useHasMounted } from '@/hooks/useHasMounted';

interface VariantCheckboxProps {
  sku: string;
  color: string;
  size: string;
  quantity: number;
  orderId: string;
  productIndex: number;
  quantityIndex?: number;
  variantId: string;

  className?: string;
  disabled?: boolean;
}

export const VariantCheckbox = ({ 
  sku, 
  color, 
  size, 
  quantity,
  orderId,
  productIndex,
  quantityIndex = 0,
  className,
  disabled,
  variantId
}: VariantCheckboxProps) => {

  const [checked, setChecked] = useState(false);
  const hasMounted = useHasMounted();
  const { currentShop } = useShop();

  useEffect(() => {
    if (!hasMounted || !currentShop) return;

    const loadCheckState = async () => {
      const { data } = await supabase
        .from('line_item_checks')
        .select('checked')
        .eq('id', variantId)
        .single();

      if (data) {
        setChecked(data.checked || false);
      }
    };

    loadCheckState();

    // Écouter les changements en temps réel
    // Note: le filtre Supabase Realtime ne gère pas bien les IDs avec espaces/caractères spéciaux,
    // donc on vérifie l'ID dans le callback pour éviter les faux positifs
    const channel = supabase
      .channel(`variant-checkbox-${variantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'line_item_checks', filter: `id=eq.${variantId}` },
        (payload: any) => {
          if (payload.new && payload.new.id === variantId && 'checked' in payload.new) {
            setChecked(payload.new.checked as boolean);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [variantId, hasMounted, currentShop]);

  const handleCheckboxChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentShop) return;
    
    const newChecked = event.target.checked;
    setChecked(newChecked); // Optimistic update

    try {
      // Upsert le check
      await supabase
        .from('line_item_checks')
        .upsert({
          id: variantId,
          shop_id: currentShop.id,
          order_id: orderId,
          sku,
          color: color || 'no-color',
          size: size || 'no-size',
          product_index: productIndex,
          quantity_index: quantityIndex,
          checked: newChecked,
        }, { onConflict: 'id' });

      // Mettre à jour le compteur de progression
      const { count } = await supabase
        .from('line_item_checks')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', currentShop.id)
        .eq('order_id', orderId)
        .eq('checked', true);

      await supabase
        .from('order_progress')
        .upsert({
          shop_id: currentShop.id,
          order_id: orderId,
          checked_count: count || 0,
        }, { onConflict: 'shop_id,order_id' });

    } catch (error) {
      console.error('Erreur lors de la mise à jour:', error);
      setChecked(!newChecked); // Revert on error
    }
  };

  // Rendu côté serveur
  if (typeof window === 'undefined') {
    return (
      <Checkbox
        checked={false}
        onChange={() => {}}
        disabled
      />
    );
  }

  // Rendu côté client
  return (
    <Checkbox
      checked={checked}
      onChange={handleCheckboxChange}
      disabled={disabled}
      className={className}
      styles={{
        root: {
          margin: 0,
          padding: 0,
          display: 'inline-flex'
        },
        inner: {
          margin: 0
        },
        body: {
          display: 'inline-flex',
          alignItems: 'center'
        }
      }}
    />
  );
};
