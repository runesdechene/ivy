'use client';
import { Menu } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { ExpenseForm } from './ExpenseForm';
import { MaskedAmount } from './MaskedAmount';
import { useExpenses, useExpenseMutations, uploadReceipt, getReceiptUrl } from '../hooks/useLedger';
import type { ExpenseStatus } from '../types';
import styles from '../comptes.module.scss';

const STATUS_LABEL: Record<ExpenseStatus, string> = {
  engage: 'Engagé',
  soumis: 'Soumis',
  rembourse: 'Remboursé',
};
const STATUSES: ExpenseStatus[] = ['engage', 'soumis', 'rembourse'];

interface Zone { id: string; name: string; }

export function ExpensesTable({ shopId, locationId, zones, revealed }: { shopId: string; locationId: string; zones: Zone[]; revealed: boolean }) {
  const { data: expenses = [], isLoading } = useExpenses(shopId, locationId);
  const { create, update } = useExpenseMutations(shopId, locationId);

  const add = async (d: { amount: number; spentOn: string; description: string; studyZoneId: string | null; file: File | null }) => {
    try {
      let receiptPath: string | null = null;
      if (d.file) {
        try { receiptPath = await uploadReceipt(shopId, d.file); }
        catch { notifications.show({ color: 'orange', message: 'Dépense enregistrée sans le reçu (upload échoué).' }); }
      }
      await create.mutateAsync({ amount: d.amount, spentOn: d.spentOn, description: d.description, studyZoneId: d.studyZoneId, receiptPath });
      notifications.show({ color: 'green', message: 'Dépense ajoutée.' });
    } catch (e) { notifications.show({ color: 'red', message: (e as Error).message }); }
  };

  const openReceipt = async (path: string) => {
    try {
      const url = await getReceiptUrl(shopId, path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) { notifications.show({ color: 'red', message: (err as Error).message }); }
  };

  const total = expenses.reduce((a, e) => a + Number(e.amount), 0);

  return (
    <div className={styles.stack}>
      <ExpenseForm zones={zones} onSubmit={add} />
      <div className={styles.card}>
        <span className={styles.cardLabel}>Dépenses engagées</span>
        {isLoading ? (
          <p className={styles.muted}>Chargement…</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.ledgerTable}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th className={styles.colRight}>Montant</th>
                  <th>Reçu</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td className={styles.dateCell}>{new Date(e.spent_on).toLocaleDateString('fr-FR')}</td>
                    <td>{e.description || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.colRight}><MaskedAmount value={Number(e.amount)} revealed={revealed} className={styles.amount} /></td>
                    <td>
                      {e.receipt_path ? (
                        <button type="button" className={styles.receiptLink} onClick={() => openReceipt(e.receipt_path!)}>Voir le reçu</button>
                      ) : (
                        <span className={`${styles.badge} ${styles.badgeMissing}`}>manquant</span>
                      )}
                    </td>
                    <td>
                      <Menu position="bottom-start" withinPortal shadow="md">
                        <Menu.Target>
                          <button type="button" className={`${styles.badge} ${styles[`badge_${e.status}`]}`} style={{ cursor: 'pointer' }}>
                            {STATUS_LABEL[e.status]}
                          </button>
                        </Menu.Target>
                        <Menu.Dropdown>
                          {STATUSES.map((s) => (
                            <Menu.Item key={s} onClick={() => update.mutate({ id: e.id, status: s })}>{STATUS_LABEL[s]}</Menu.Item>
                          ))}
                        </Menu.Dropdown>
                      </Menu>
                    </td>
                  </tr>
                ))}
                {expenses.length === 0 && (
                  <tr><td colSpan={5} className={styles.emptyRow}>Aucune dépense pour le moment.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className={styles.totalRow}>
          <span className={styles.totalLabel}>Total engagé</span>
          <MaskedAmount value={total} revealed={revealed} className={styles.totalAmount} />
        </div>
      </div>
    </div>
  );
}
