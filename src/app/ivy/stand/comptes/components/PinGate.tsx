'use client';
import { useState } from 'react';
import { Button, PinInput } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import styles from '../comptes.module.scss';

export function PinGate({ onUnlock }: { onUnlock: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (value: string) => {
    setBusy(true); setErr('');
    try { await onUnlock(value); } catch (e) { setErr((e as Error).message); setPin(''); } finally { setBusy(false); }
  };

  return (
    <div className={styles.gateWrap}>
      <div className={styles.gateCard}>
        <div className={styles.gateIcon}><IconLock size={24} /></div>
        <h1 className={styles.gateTitle}>Accès protégé</h1>
        <p className={styles.gateText}>Saisis ton PIN pour afficher tes comptes.</p>
        <div className={styles.gateInputs}>
          <PinInput length={6} type="number" value={pin} onChange={setPin} onComplete={submit} disabled={busy} aria-label="PIN" />
          {err && <p className={styles.gateError}>{err}</p>}
          <Button onClick={() => submit(pin)} loading={busy} disabled={pin.length < 6} color="#6b7a55" fullWidth radius="md">Déverrouiller</Button>
        </div>
      </div>
    </div>
  );
}
