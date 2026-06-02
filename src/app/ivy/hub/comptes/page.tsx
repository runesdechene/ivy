'use client';
import { useEffect, useState } from 'react';
import { ActionIcon, Group, Loader, Tabs, Title, Tooltip } from '@mantine/core';
import { IconLock, IconReceipt, IconCash, IconEye, IconEyeOff } from '@tabler/icons-react';
import { useShop } from '@/context/ShopContext';
import { hubJson } from './api-client';
import { usePinLock } from './hooks/usePinLock';
import { PinSetup } from './components/PinSetup';
import { PinGate } from './components/PinGate';
import { ExpensesTable } from './components/ExpensesTable';
import { CashTable } from './components/CashTable';
import styles from './comptes.module.scss';

interface Zone { id: string; name: string; }

export default function ComptesPage() {
  const { currentShop } = useShop();
  const shopId = currentShop?.id;
  const { state, setup, unlock, lock } = usePinLock(shopId);
  const [zones, setZones] = useState<Zone[]>([]);
  const [revealed, setRevealed] = useState(true);

  useEffect(() => {
    if (!shopId || state !== 'unlocked') return;
    hubJson<{ zones: Zone[] }>(`/api/pos/study-zones?shopId=${shopId}`).then((r) => setZones(r.zones)).catch(() => setZones([]));
  }, [shopId, state]);

  if (!shopId || state === 'loading') return <Group justify="center" mt="xl"><Loader /></Group>;
  if (state === 'needs-setup') return <div className={styles.page}><PinSetup onSubmit={setup} /></div>;
  if (state === 'locked') return <div className={styles.page}><PinGate onUnlock={unlock} /></div>;

  return (
    <div className={styles.page}>
      <Group className={styles.lockBtn} gap="xs">
        <Tooltip label={revealed ? 'Masquer les montants' : 'Afficher les montants'}>
          <ActionIcon variant="subtle" onClick={() => setRevealed((v) => !v)} aria-label="Afficher/masquer">
            {revealed ? <IconEyeOff size={18} /> : <IconEye size={18} />}
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Verrouiller">
          <ActionIcon variant="subtle" onClick={lock} aria-label="Verrouiller"><IconLock size={18} /></ActionIcon>
        </Tooltip>
      </Group>
      <Title order={2} mb="md">Comptes de stand</Title>
      <Tabs defaultValue="depenses">
        <Tabs.List>
          <Tabs.Tab value="depenses" leftSection={<IconReceipt size={16} />}>Dépenses</Tabs.Tab>
          <Tabs.Tab value="caisse" leftSection={<IconCash size={16} />}>Caisse</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="depenses" pt="md"><ExpensesTable shopId={shopId} zones={zones} revealed={revealed} /></Tabs.Panel>
        <Tabs.Panel value="caisse" pt="md"><CashTable shopId={shopId} zones={zones} revealed={revealed} /></Tabs.Panel>
      </Tabs>
    </div>
  );
}
