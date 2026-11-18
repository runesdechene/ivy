import { Button } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useShop } from '@/context/ShopContext';
import styles from './SyncButton.module.scss';
import { authFetch } from '@/lib/auth-fetch';

export function SyncButton() {
  const [isSyncing, setIsSyncing] = useState(false);
  const { currentShop } = useShop();

  const handleSync = async () => {
    if (!currentShop) {
      notifications.show({
        title: 'Erreur',
        message: 'Aucune boutique sélectionnée',
        color: 'red',
      });
      return;
    }

    try {
      setIsSyncing(true);
      
      const response = await authFetch('/api/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ shopId: currentShop.id }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Erreur de synchronisation');
      }

      notifications.show({
        title: 'Synchronisation réussie',
        message: `${result.ordersCount} commandes synchronisées`,
        color: 'green',
      });
    } catch (error) {
      notifications.show({
        title: 'Erreur de synchronisation',
        message: error instanceof Error ? error.message : 'Une erreur est survenue',
        color: 'red',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Button
      className={styles.syncButton}
      variant="light"
      onClick={handleSync}
      loading={isSyncing}
      leftSection={<IconRefresh size={16} />}
      fullWidth
      size="md"
      loaderProps={{ color: 'rgb(170, 84, 34)' }}
    >
      Synchroniser les commandes
    </Button>
  );
}
