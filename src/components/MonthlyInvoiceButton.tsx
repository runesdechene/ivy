import { useState } from 'react';
import { Button, Group } from '@mantine/core';
import { doc, writeBatch, setDoc, getDoc, DocumentSnapshot, DocumentData } from 'firebase/firestore';
import { encodeFirestoreId } from '@/utils/firebase-helpers';
import { db } from '@/firebase/db';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useBillingNotes } from '@/hooks/useBillingNotes';
import { useMonthlyBalance } from '@/hooks/useMonthlyBalance';
import { HANDLING_FEE } from '@/config/billing';
import { generateVariantId, getColorFromVariant, getSizeFromVariant, getSelectedOptions } from '@/utils/variant-helpers';
import { reverseTransformColor } from '@/utils/color-transformer';
import { usePriceRules, calculateItemPrice } from '@/hooks/usePriceRules';

interface MonthlyInvoiceButtonProps {
  orders: Array<{
    id: string;
    tags?: string[];
    lineItems?: Array<{
      sku?: string;
      variantTitle?: string;
      quantity: number;
      variant?: {
        id?: string;
        metafields?: Array<{
          namespace: string;
          key: string;
          value: string;
        }>;
        selectedOptions?: Array<{
          name: string;
          value: string;
        }>;
      };
    }>;
  }>;
  monthId: string;
}

export function MonthlyInvoiceButton({ orders, monthId }: MonthlyInvoiceButtonProps) {
  const [isInvoicing, setIsInvoicing] = useState(false);
  const [isUninvoicing, setIsUninvoicing] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const { rules } = usePriceRules();

  const calculateOrderCost = async (order: typeof orders[0]) => {
    const orderId = encodeFirestoreId(order.id);
    const lineItems = order.lineItems || [];
    
    // Récupérer la balance de la commande
    const balanceRef = doc(db, 'orders-balance', orderId);
    const balanceSnap = await getDoc(balanceRef);
    const balance = balanceSnap.exists() ? balanceSnap.data().amount || 0 : 0;

    let totalCost = 0;
    let hasCheckedVariants = false;

    // Filtrer les lineItems qui ont un SKU
    const validLineItems = lineItems.filter(item => item.sku);

    // Calculer le coût pour chaque ligne
    for (let index = 0; index < validLineItems.length; index++) {
      const item = validLineItems[index];
      const rawColor = getColorFromVariant(item);
      // Convertir la couleur en français pour correspondre aux règles de facturation
      const color = reverseTransformColor(rawColor);
      const size = getSizeFromVariant(item);
      const selectedOptions = getSelectedOptions(item);
      
      // Générer les IDs pour toutes les variantes de cette ligne
      // ATTENTION : On utilise rawColor (originale) pour les IDs Firebase
      const variantIds = Array.from({ length: item.quantity }).map((_, quantityIndex) => {
        return generateVariantId(
          orderId,
          item.sku || '',
          rawColor,
          size,
          index,
          quantityIndex,
          selectedOptions
        );
      });

      // Compter les variantes cochées
      const checkedVariantsQuery = query(
        collection(db, 'variants-ordered-v2'),
        where('__name__', 'in', variantIds)
      );
      const checkedVariantsSnapshot = await getDocs(checkedVariantsQuery);
      const checkedCount = checkedVariantsSnapshot.docs.filter(doc => doc.data().checked).length;

      // Si des variantes sont cochées, calculer leur coût
      if (checkedCount > 0) {
        hasCheckedVariants = true;
        let itemCost = 0;

        // Prix de base (SKU + couleur en français)
        const baseItemString = `${item.sku} - ${color}`;
        const basePrice = calculateItemPrice(baseItemString, rules);
        itemCost += basePrice;

        // Prix du fichier d'impression
        const printFile = item.variant?.metafields?.find(m => m.namespace === 'custom' && m.key === 'fichier_d_impression');
        if (printFile) {
          const printPrice = rules.find(r => r.searchString.toLowerCase() === printFile.value.toLowerCase())?.price || 0;
          itemCost += printPrice;
        }

        // Prix du verso
        const versoFile = item.variant?.metafields?.find(m => m.namespace === 'custom' && m.key === 'verso_impression');
        if (versoFile) {
          const versoPrice = rules.find(r => r.searchString.toLowerCase() === versoFile.value.toLowerCase())?.price || 0;
          itemCost += versoPrice;
        }

        // Multiplier par le nombre de variantes cochées
        totalCost += itemCost * checkedCount;
      }
    }

    // Ajouter la manutention une seule fois si au moins une variante est cochée
    if (hasCheckedVariants) {
      totalCost += HANDLING_FEE;
    }

    // Sauvegarder dans Firebase
    await setDoc(doc(db, 'orders-cost', orderId), {
      total: totalCost + balance,
      updatedAt: new Date().toISOString(),
    });

    return totalCost + balance;
  };

  const calculateMonthTotal = async (ordersToInvoice: typeof orders) => {
    console.log('📊 Calcul du total mensuel pour', ordersToInvoice.length, 'commandes');
    
    let total = 0;
    
    // Calculer le coût de chaque commande
    for (const order of ordersToInvoice) {
      const orderCost = await calculateOrderCost(order);
      total += orderCost;
      console.log(`   ✅ ${order.id}: ${orderCost.toFixed(2)}€ HT`);
    }

    console.log('💰 Total mensuel:', total.toFixed(2), '€ HT');
    return total;
  };

  const updateInvoiceStatus = async (setInvoiced: boolean) => {
    const setLoading = setInvoiced ? setIsInvoicing : setIsUninvoicing;
    setLoading(true);

    try {
      const batch = writeBatch(db);
      
      const ordersToInvoice = orders.filter(order => 
        !order.tags?.some(tag => tag.toLowerCase().includes('batch'))
      );

      // Récupérer la note mensuelle
      const monthlyNoteRef = doc(db, 'MonthlyBillingNotes', monthId);
      const monthlyNoteSnap = await getDoc(monthlyNoteRef);
      const monthlyNoteData = monthlyNoteSnap.exists() ? monthlyNoteSnap.data() : {};
      const deliveryCost = monthlyNoteData.deliveryCost || 0;
      const balance = monthlyNoteData.balance || 0;

      // Mettre à jour le statut de facturation pour chaque commande
      ordersToInvoice.forEach(order => {
        // Extraire uniquement le numéro de commande de l'ID Shopify
        const orderId = order.id.split('/').pop() || '';
        const docRef = doc(db, 'InvoiceStatus', orderId);
        batch.set(docRef, {
          invoiced: setInvoiced,
          updatedAt: new Date().toISOString()
        });
      });

      await batch.commit();

      // Si on facture (pas si on défacture), on calcule et sauvegarde le total
      if (setInvoiced) {
        const ordersTotal = await calculateMonthTotal(ordersToInvoice);
        const monthlyNoteRef = doc(db, 'MonthlyBillingNotes', monthId);
        const monthlyNoteSnap = await getDoc(monthlyNoteRef);
        const monthlyNoteData = monthlyNoteSnap.exists() ? monthlyNoteSnap.data() : {};
        const monthlyBalance = monthlyNoteData.balance || 0;

        const finalTotal = ordersTotal + Number(monthlyBalance);
        setTotal(finalTotal);

        await setDoc(monthlyNoteRef, {
          total: finalTotal,
          invoicedAt: new Date().toISOString()
        }, { merge: true });
      }
    } catch (error) {
      console.error('Erreur lors de la mise à jour des factures:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInvoiceMonth = () => updateInvoiceStatus(true);
  const handleUninvoiceMonth = () => updateInvoiceStatus(false);

  return (
    <Group gap="sm">
      <Button
        onClick={handleInvoiceMonth}
        loading={isInvoicing}
        variant="light"
        color="slate"
      >
        Facturer tout le mois
      </Button>
      <Button
        onClick={handleUninvoiceMonth}
        loading={isUninvoicing}
        variant="light"
        color="rust"
      >
        Défacturer le mois
      </Button>
    </Group>
  );
}
