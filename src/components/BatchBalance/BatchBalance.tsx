import { useState, useEffect } from 'react';
import { NumberInput, Button, Group } from '@mantine/core';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/firebase/db';
import { encodeFirestoreId } from '@/utils/firebase-helpers';
import { notifications } from '@mantine/notifications';

interface BatchBalanceProps {
  orderId: string;
}

export function BatchBalance({ orderId }: BatchBalanceProps) {
  const [balance, setBalance] = useState<number>(0);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchBalance = async () => {
      const encodedId = encodeFirestoreId(orderId);
      const balanceDoc = await getDoc(doc(db, 'BillingNotesBatch', encodedId));
      if (balanceDoc.exists()) {
        setBalance(balanceDoc.data().balance || 0);
      } else {
        setBalance(0);
      }
    };

    fetchBalance();
  }, [orderId]);

  const saveBalance = async () => {
    try {
      setIsSaving(true);
      const encodedId = encodeFirestoreId(orderId);
      await setDoc(doc(db, 'BillingNotesBatch', encodedId), {
        balance,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      notifications.show({
        title: 'Balance enregistrée',
        message: 'La balance a été sauvegardée avec succès',
        color: 'green'
      });
    } catch (error) {
      notifications.show({
        title: 'Erreur',
        message: 'Impossible d\'enregistrer la balance',
        color: 'red'
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Group gap="sm">
      <NumberInput
        label="Balance (€ HT)"
        placeholder="0"
        decimalScale={2}
        fixedDecimalScale
        allowNegative
        value={balance}
        onChange={(value) => setBalance(typeof value === 'string' ? parseFloat(value) : value || 0)}
        w={200}
      />
      <Button
        onClick={saveBalance}
        loading={isSaving}
        variant="light"
        color="slate"
      >
        Enregistrer
      </Button>
    </Group>
  );
}
