'use client';
import { useEffect, useState } from 'react';
import { ActionIcon, Loader, Tooltip } from '@mantine/core';
import { IconLock, IconReceipt, IconCash, IconEye, IconEyeOff } from '@tabler/icons-react';
import { useShop } from '@/context/ShopContext';
import { useLocation } from '@/context/LocationContext';
import { hubJson } from './api-client';
import { usePinLock } from './hooks/usePinLock';
import { PinSetup } from './components/PinSetup';
import { PinGate } from './components/PinGate';
import { ExpensesTable } from './components/ExpensesTable';
import { CashTable } from './components/CashTable';
import styles from './comptes.module.scss';

interface Zone { id: string; name: string; }
type Tab = 'depenses' | 'caisse';

export default function ComptesPage() {
  const { currentShop } = useShop();
  const { currentLocation } = useLocation();
  const shopId = currentShop?.id;
  const locationId = currentLocation?.id;
  const { state, setup, unlock, lock } = usePinLock(shopId);
  const [zones, setZones] = useState<Zone[]>([]);
  const [revealed, setRevealed] = useState(true);
  const [tab, setTab] = useState<Tab>('depenses');

  useEffect(() => {
    if (!shopId || state !== 'unlocked') return;
    hubJson<{ zones: Zone[] }>(`/api/pos/study-zones?shopId=${shopId}`).then((r) => setZones(r.zones)).catch(() => setZones([]));
  }, [shopId, state]);

  if (!shopId || state === 'loading') return <div className={styles.gateWrap}><Loader color="#6b7a55" /></div>;
  if (state === 'needs-setup') return <PinSetup onSubmit={setup} />;
  if (state === 'locked') return <PinGate onUnlock={unlock} />;

  return (
    <div className={styles.container}>
      <header className={styles.pageHead}>
        <div>
          <div className={styles.eyebrow}>Festivals · Runes de Chêne</div>
          <h1 className={styles.title}>Comptes de <em>stand</em></h1>
          <div className={styles.sub}>
            Dépenses engagées &amp; suivi de caisse{currentLocation ? ` · ${currentLocation.name}` : ''}
          </div>
        </div>
        <div className={styles.controls}>
          <Tooltip label={revealed ? 'Masquer les montants' : 'Afficher les montants'}>
            <ActionIcon variant="subtle" color="gray" onClick={() => setRevealed((v) => !v)} aria-label="Afficher/masquer">
              {revealed ? <IconEyeOff size={18} /> : <IconEye size={18} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Verrouiller">
            <ActionIcon variant="subtle" color="gray" onClick={lock} aria-label="Verrouiller"><IconLock size={18} /></ActionIcon>
          </Tooltip>
        </div>
      </header>

      <div className={styles.segmented} role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'depenses'}
          className={`${styles.segItem} ${tab === 'depenses' ? styles.segItemActive : ''}`}
          onClick={() => setTab('depenses')}
        >
          <IconReceipt size={15} /> Dépenses
        </button>
        <button
          role="tab"
          aria-selected={tab === 'caisse'}
          className={`${styles.segItem} ${tab === 'caisse' ? styles.segItemActive : ''}`}
          onClick={() => setTab('caisse')}
        >
          <IconCash size={15} /> Caisse
        </button>
      </div>

      {!locationId ? (
        <div className={styles.card}><p className={styles.muted}>Sélectionne un emplacement (sélecteur en haut à gauche) pour voir ses comptes.</p></div>
      ) : tab === 'depenses' ? (
        <ExpensesTable shopId={shopId} locationId={locationId} zones={zones} revealed={revealed} />
      ) : (
        <CashTable shopId={shopId} locationId={locationId} revealed={revealed} />
      )}
    </div>
  );
}
