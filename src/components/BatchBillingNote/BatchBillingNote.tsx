import { useEffect, useState } from 'react';
import { Textarea, Button, Group } from '@mantine/core';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/firebase/db';
import { encodeFirestoreId } from '@/utils/firebase-helpers';
import { notifications } from '@mantine/notifications';

interface BatchBillingNoteProps {
  orderId: string;
}

export function BatchBillingNote({ orderId }: BatchBillingNoteProps) {
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchNote = async () => {
      const noteDoc = await getDoc(doc(db, 'BillingNotesBatch', orderId));
      if (noteDoc.exists()) {
        setNote(noteDoc.data().content || '');
      }
    };

    fetchNote();
  }, [orderId]);

  const saveNote = async () => {
    try {
      setIsSaving(true);
      await setDoc(doc(db, 'BillingNotesBatch', orderId), {
        content: note,
        updatedAt: new Date().toISOString()
      });
      notifications.show({
        title: 'Note enregistrée',
        message: 'La note a été sauvegardée avec succès',
        color: 'green'
      });
    } catch (error) {
      notifications.show({
        title: 'Erreur',
        message: 'Impossible d\'enregistrer la note',
        color: 'red'
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Group gap="sm">
      <Textarea
        placeholder="Note de facturation..."
        value={note}
        onChange={(event) => setNote(event.currentTarget.value)}
        minRows={2}
        maxRows={4}
        w="100%"
        styles={{
          input: {
            backgroundColor: 'var(--mantine-color-gray-0)'
          }
        }}
      />
      <Button
        onClick={saveNote}
        loading={isSaving}
        variant="light"
        color="slate"
      >
        Enregistrer
      </Button>
    </Group>
  );
}
