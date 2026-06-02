'use client';
import { useState } from 'react';
import { ActionIcon, Button, Group, NumberInput, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { IconTrash, IconArrowUp, IconArrowDown } from '@tabler/icons-react';
import { MaskedAmount } from './MaskedAmount';
import { useCashLedger, useCashMutations } from '../hooks/useLedger';
import styles from '../comptes.module.scss';

export function CashTable({ shopId, locationId, revealed }: { shopId: string; locationId: string; revealed: boolean }) {
  const { data } = useCashLedger(shopId, locationId);
  const { create, remove } = useCashMutations(shopId, locationId);
  const balance = data?.balance ?? 0;
  const movements = data?.movements ?? [];

  const [dir, setDir] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState<number | string>('');
  const [justification, setJustification] = useState('');
  const [occurredOn, setOccurredOn] = useState<string>(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (typeof amount !== 'number' || amount <= 0 || !occurredOn) return;
    setBusy(true);
    try {
      const signed = dir === 'in' ? amount : -amount;
      await create.mutateAsync({ amount: signed, occurredOn, justification });
      setAmount(''); setJustification('');
      notifications.show({ color: 'green', message: dir === 'in' ? 'Entrée enregistrée.' : 'Sortie enregistrée.' });
    } catch (e) { notifications.show({ color: 'red', message: (e as Error).message }); }
    finally { setBusy(false); }
  };

  const negative = balance < 0;

  return (
    <div className={styles.stack}>
      <div className={styles.balanceCard}>
        <div className={styles.balanceLabel}>Solde de caisse</div>
        <MaskedAmount value={balance} revealed={revealed} className={`${styles.balanceValue} ${negative ? styles.balanceValueNeg : ''}`} />
      </div>

      <div className={styles.card}>
        <span className={styles.cardLabel}>Nouveau mouvement</span>
        <div className={styles.stack}>
          <div className={styles.dirToggle}>
            <button type="button" className={`${styles.dirItem} ${dir === 'in' ? styles.dirItemIn : ''}`} onClick={() => setDir('in')}>
              <IconArrowUp size={15} /> Entrée
            </button>
            <button type="button" className={`${styles.dirItem} ${dir === 'out' ? styles.dirItemOut : ''}`} onClick={() => setDir('out')}>
              <IconArrowDown size={15} /> Sortie
            </button>
          </div>
          <Group grow>
            <NumberInput label="Montant (€)" value={amount} onChange={setAmount} min={0} decimalScale={2} thousandSeparator=" " />
            <DateInput label="Date" value={occurredOn} onChange={(v) => setOccurredOn(v ?? '')} valueFormat="DD/MM/YYYY" />
          </Group>
          <TextInput
            label="Justification"
            placeholder={dir === 'in' ? "D'où vient cet argent ?" : 'Pour quoi cette sortie ?'}
            value={justification}
            onChange={(e) => setJustification(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button onClick={submit} loading={busy} color="#6b7a55" disabled={typeof amount !== 'number' || amount <= 0}>
              {dir === 'in' ? "Ajouter l'entrée" : 'Ajouter la sortie'}
            </Button>
          </Group>
        </div>
      </div>

      <div className={styles.card}>
        <span className={styles.cardLabel}>Historique des mouvements</span>
        <div className={styles.tableWrap}>
          <table className={styles.ledgerTable}>
            <thead>
              <tr><th>Date</th><th>Justification</th><th>Type</th><th className={styles.colRight}>Montant</th><th></th></tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const isIn = Number(m.amount) >= 0;
                return (
                  <tr key={m.id}>
                    <td className={styles.dateCell}>{new Date(m.occurred_on).toLocaleDateString('fr-FR')}</td>
                    <td>{m.justification || <span className={styles.muted}>—</span>}</td>
                    <td><span className={`${styles.chip} ${isIn ? styles.chipIn : styles.chipOut}`}>{isIn ? 'Entrée' : 'Sortie'}</span></td>
                    <td className={styles.colRight}>
                      <MaskedAmount value={Number(m.amount)} revealed={revealed} className={`${styles.amount} ${isIn ? styles.amountMoss : styles.amountRust}`} />
                    </td>
                    <td className={styles.colRight}>
                      <ActionIcon variant="subtle" color="gray" onClick={() => remove.mutate(m.id)} aria-label="Supprimer"><IconTrash size={15} /></ActionIcon>
                    </td>
                  </tr>
                );
              })}
              {movements.length === 0 && (
                <tr><td colSpan={5} className={styles.emptyRow}>Aucun mouvement. Commence par enregistrer ton fond de caisse en « Entrée ».</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
