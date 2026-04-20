'use client';

import { Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { db } from '@/firebase/config';
import { collection, query, where, getDocs, deleteDoc, doc, updateDoc } from 'firebase/firestore';

interface CleanVariantsButtonProps {
  orderId: string;
  orderName?: string;
}

export function CleanVariantsButton({ orderId, orderName }: CleanVariantsButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleClean = async () => {
    if (!confirm(`Êtes-vous sûr de vouloir réinitialiser toutes les checkboxes de la commande ${orderName || orderId} ?`)) {
      return;
    }

    setIsLoading(true);

    try {
      // 1. Récupérer toutes les variantes de cette commande
      const variantsRef = collection(db, 'variants-ordered-v2');
      const q = query(variantsRef, where('orderId', '==', orderId));
      const snapshot = await getDocs(q);
      
      console.log(`📦 ${snapshot.size} variantes trouvées pour ${orderName || orderId}`);
      
      // 2. Supprimer toutes les variantes
      const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);
      
      console.log(`✅ ${snapshot.size} variantes supprimées`);
      
      // 3. Réinitialiser le compteur dans textile-progress-v2
      const progressRef = doc(db, 'textile-progress-v2', orderId);
      await updateDoc(progressRef, {
        checkedCount: 0
      });
      
      console.log(`✅ Compteur réinitialisé à 0`);

      notifications.show({
        title: 'Nettoyage réussi',
        message: `${snapshot.size} anciennes variantes supprimées. Rechargez la page pour voir les changements.`,
        color: 'green',
      });

      // Recharger la page après 1 seconde
      setTimeout(() => {
        window.location.reload();
      }, 1000);

    } catch (error) {
      console.error('❌ Erreur lors du nettoyage:', error);
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de nettoyer les variantes. Vérifiez la console.',
        color: 'red',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      leftSection={<IconTrash size={16} />}
      onClick={handleClean}
      loading={isLoading}
      variant="light"
      color="clay"
      size="xs"
    >
      Réinitialiser les checkboxes
    </Button>
  );
}
