'use client';
import { useState } from 'react';
import { ActionIcon, Button, Group, NumberInput, Select } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { IconTrash, IconAlertTriangle } from '@tabler/icons-react';
import { CashOutflowForm } from './CashOutflowForm';
import { MaskedAmount } from './MaskedAmount';
import { useCashSessions, useCashSessionMutations, useOutflows, useOutflowMutations } from '../hooks/useLedger';
import styles from '../comptes.module.scss';

interface Zone { id: string; name: string; }

export function CashTable({ shopId, zones, revealed }: { shopId: string; zones: Zone[]; revealed: boolean }) {
  const { data: sessions = [] } = useCashSessions(shopId);
  const { create: createSession } = useCashSessionMutations(shopId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newFloat, setNewFloat] = useState<number | string>('');
  const [newDate, setNewDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [newZone, setNewZone] = useState<string | null>(null);

  const current = sessions.find((s) => s.id === selectedId) ?? sessions[0] ?? null;
  const { data: outflows = [] } = useOutflows(current?.id);
  const { create: addOutflow, remove: removeOutflow } = useOutflowMutations(shopId, current?.id);

  const openSession = async () => {
    if (typeof newFloat !== 'number' || !newDate) return;
    try {
      const r = await createSession.mutateAsync({ openingFloat: newFloat, openedOn: newDate, studyZoneId: newZone });
      setSelectedId(r.session.id); setNewFloat('');
      notifications.show({ color: 'green', message: 'Caisse ouverte.' });
    } catch (e) { notifications.show({ color: 'red', message: (e as Error).message }); }
  };

  const negative = current ? current.balance < 0 : false;

  return (
    <div className={styles.stack}>
      <div className={styles.card}>
        <span className={styles.cardLabel}>Caisse du festival</span>
        <Select
          data={sessions.map((s) => ({ value: s.id, label: `${new Date(s.opened_on).toLocaleDateString('fr-FR')} — ${zones.find((z) => z.id === s.study_zone_id)?.name ?? 'sans festival'}` }))}
          value={current?.id ?? null}
          onChange={setSelectedId}
          placeholder="Choisir une caisse"
        />
      </div>

      {current && (
        <>
          <div className={styles.metrics}>
            <div className={styles.metric}>
              <div className={styles.metricLabel}>Fond de caisse</div>
              <div className={styles.metricValue}><MaskedAmount value={Number(current.opening_float)} revealed={revealed} /></div>
            </div>
            <div className={styles.metric}>
              <div className={styles.metricLabel}>Sorties</div>
              <div className={styles.metricValue}><MaskedAmount value={Number(current.total_outflows)} revealed={revealed} /></div>
            </div>
            <div className={`${styles.metric} ${negative ? styles.metricBalanceNeg : styles.metricBalance}`}>
              <div className={styles.metricLabel}>Solde</div>
              <div className={styles.metricValue}>
                <MaskedAmount value={Number(current.balance)} revealed={revealed} className={negative ? styles.amountRust : styles.amountMoss} />
              </div>
            </div>
          </div>

          {negative && (
            <div className={styles.warn}><IconAlertTriangle size={16} /> Solde négatif : plus de sorties que le fond de caisse.</div>
          )}

          <div className={styles.card}>
            <span className={styles.cardLabel}>Ajouter une sortie</span>
            <CashOutflowForm onSubmit={async (d) => {
              try { await addOutflow.mutateAsync(d); notifications.show({ color: 'green', message: 'Sortie ajoutée.' }); }
              catch (e) { notifications.show({ color: 'red', message: (e as Error).message }); }
            }} />
          </div>

          <div className={styles.card}>
            <span className={styles.cardLabel}>Sorties piochées</span>
            <div className={styles.tableWrap}>
              <table className={styles.ledgerTable}>
                <thead>
                  <tr><th>Date</th><th>Motif</th><th className={styles.colRight}>Montant</th><th></th></tr>
                </thead>
                <tbody>
                  {outflows.map((o) => (
                    <tr key={o.id}>
                      <td className={styles.dateCell}>{new Date(o.spent_on).toLocaleDateString('fr-FR')}</td>
                      <td>{o.description || <span className={styles.muted}>—</span>}</td>
                      <td className={styles.colRight}><MaskedAmount value={Number(o.amount)} revealed={revealed} className={styles.amount} /></td>
                      <td className={styles.colRight}>
                        <ActionIcon variant="subtle" color="gray" onClick={() => removeOutflow.mutate(o.id)} aria-label="Supprimer"><IconTrash size={15} /></ActionIcon>
                      </td>
                    </tr>
                  ))}
                  {outflows.length === 0 && (
                    <tr><td colSpan={4} className={styles.emptyRow}>Aucune sortie.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className={styles.card}>
        <span className={styles.cardLabel}>Ouvrir une nouvelle caisse</span>
        <Group align="flex-end" grow>
          <NumberInput label="Fond de caisse (€)" value={newFloat} onChange={setNewFloat} min={0} decimalScale={2} />
          <DateInput label="Date d'ouverture" value={newDate} onChange={(v) => setNewDate(v ?? '')} valueFormat="DD/MM/YYYY" />
          <Select label="Festival" data={zones.map((z) => ({ value: z.id, label: z.name }))} value={newZone} onChange={setNewZone} clearable searchable />
          <Button onClick={openSession} color="#6b7a55" loading={createSession.isPending}>Ouvrir</Button>
        </Group>
      </div>
    </div>
  );
}
