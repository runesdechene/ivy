'use client';
import { useState } from 'react';
import { Button, PinInput } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import styles from '../comptes.module.scss';

export function PinSetup({ onSubmit }: { onSubmit: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (pin.length < 6) return setErr('Le PIN doit faire 6 chiffres.');
    if (pin !== confirm) return setErr('Les deux PIN ne correspondent pas.');
    setBusy(true); setErr('');
    try { await onSubmit(pin); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className={styles.gateWrap}>
      <div className={styles.gateCard}>
        <div className={styles.gateIcon}><IconLock size={24} /></div>
        <h1 className={styles.gateTitle}>Définir un code PIN</h1>
        <p className={styles.gateText}>Ce code protège l&apos;accès à tes comptes de stand. Il n&apos;est stocké que sous forme chiffrée — irrécupérable.</p>
        <div className={styles.gateInputs}>
          <div className={styles.gateField}>
            <span className={styles.gateFieldLabel}>Nouveau PIN</span>
            <PinInput length={6} type="number" value={pin} onChange={setPin} aria-label="Nouveau PIN" />
          </div>
          <div className={styles.gateField}>
            <span className={styles.gateFieldLabel}>Confirmer</span>
            <PinInput length={6} type="number" value={confirm} onChange={setConfirm} aria-label="Confirmer le PIN" />
          </div>
          {err && <p className={styles.gateError}>{err}</p>}
          <Button onClick={submit} loading={busy} color="#6b7a55" fullWidth radius="md">Enregistrer le PIN</Button>
        </div>
      </div>
    </div>
  );
}
