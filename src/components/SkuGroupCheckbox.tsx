'use client';

import { Button, Group } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useEffect, useState } from 'react';
import { db } from '@/firebase/config';
import { doc, onSnapshot, setDoc, getDocs, collection, query, where, getDoc, DocumentData } from 'firebase/firestore';
import { ordersService } from '@/firebase/services/orders';

interface SkuGroupCheckboxProps {
  sku: string;
  variants: Array<{
    variant: {
      sku: string;
      productIndex: number;
    };
    encodedOrderId: string;
    variantId: string;
    index: number;
    color: string;
    size: string;
  }>;
}

interface VariantDocument {
  checked: boolean;
  sku: string;
  color: string;
  size: string;
  originalId: string;
  updatedAt: string;
  orderId: string;
}

export const SkuGroupActions = ({ 
  sku,
  variants
}: SkuGroupCheckboxProps) => {
  const updateAllVariants = async (newChecked: boolean) => {
    try {
      // Mettre à jour toutes les variantes du SKU
      for (const { variant, encodedOrderId, variantId, color, size } of variants) {
        const document: VariantDocument = {
          checked: newChecked,
          sku: variant.sku,
          color: color || 'no-color',
          size: size || 'no-size',
          originalId: encodedOrderId,
          updatedAt: new Date().toISOString(),
          orderId: encodedOrderId
        };

        const variantRef = doc(db, 'variants-ordered-v2', variantId);
        await setDoc(variantRef, document);
        
        // Mettre à jour le compteur pour chaque commande
        await ordersService.updateCheckedCount(encodedOrderId);
      }

      notifications.show({
        title: 'Succès',
        message: `Toutes les variantes ${sku} ont été ${newChecked ? 'cochées' : 'décochées'}`,
        color: 'green'
      });
    } catch (error) {
      console.error('Erreur lors de la mise à jour:', error);
      notifications.show({
        title: 'Erreur',
        message: 'Une erreur est survenue lors de la mise à jour des variantes',
        color: 'red'
      });
    }
  };

  const handleCheck = () => {
    modals.openConfirmModal({
      title: 'Confirmation',
      children: `Voulez-vous vraiment cocher toutes les variantes ${sku} (${variants.length}) ?`,
      labels: { confirm: 'Confirmer', cancel: 'Annuler' },
      confirmProps: { color: 'blue' },
      onConfirm: () => updateAllVariants(true)
    });
  };

  const handleUncheck = () => {
    modals.openConfirmModal({
      title: 'Confirmation',
      children: `Voulez-vous vraiment décocher toutes les variantes ${sku} (${variants.length}) ?`,
      labels: { confirm: 'Confirmer', cancel: 'Annuler' },
      confirmProps: { color: 'red' },
      onConfirm: () => updateAllVariants(false)
    });
  };

  return (
    <Group gap="xs">
      <Button
        size="sm"
        variant="light"
        color="slate"
        onClick={handleCheck}
      >
        Tout cocher {sku} ({variants.length})
      </Button>
      <Button
        size="sm"
        variant="light"
        color="rust"
        onClick={handleUncheck}
      >
        Tout décocher
      </Button>
    </Group>
  );
};
