import { Badge } from '@mantine/core';
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase/db';
import { encodeFirestoreId } from '@/utils/firebase-helpers';

interface TextileStatusProps {
  orderId: string;
  itemId: string;
}

export function TextileStatus({ orderId, itemId }: TextileStatusProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const encodedOrderId = encodeFirestoreId(orderId);
    const encodedItemId = encodeFirestoreId(itemId);
    const docRef = doc(db, 'TextileProgress', `${encodedOrderId}_${encodedItemId}`);

    const unsubscribe = onSnapshot(docRef, (doc) => {
      if (doc.exists()) {
        setStatus(doc.data().status || null);
      } else {
        setStatus(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [orderId, itemId]);

  if (loading) {
    return <Badge color="gray">Chargement...</Badge>;
  }

  if (!status) {
    return <Badge color="rust">Non commencé</Badge>;
  }

  switch (status.toLowerCase()) {
    case 'done':
      return <Badge color="moss">Terminé</Badge>;
    case 'in_progress':
      return <Badge color="sand">En cours</Badge>;
    case 'blocked':
      return <Badge color="rust">Bloqué</Badge>;
    default:
      return <Badge color="gray">{status}</Badge>;
  }
}
