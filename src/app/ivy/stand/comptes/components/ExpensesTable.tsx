'use client';
import { Anchor, Badge, Group, Select, Stack, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { ExpenseForm } from './ExpenseForm';
import { MaskedAmount } from './MaskedAmount';
import { useExpenses, useExpenseMutations, uploadReceipt, getReceiptUrl } from '../hooks/useLedger';
import type { ExpenseStatus } from '../types';

const STATUS_LABEL: Record<ExpenseStatus, { label: string; color: string }> = {
  engage: { label: 'Engagé', color: 'gray' },
  soumis: { label: 'Soumis', color: 'blue' },
  rembourse: { label: 'Remboursé', color: 'green' },
};

interface Zone { id: string; name: string; }

export function ExpensesTable({ shopId, zones, revealed }: { shopId: string; zones: Zone[]; revealed: boolean }) {
  const { data: expenses = [], isLoading } = useExpenses(shopId);
  const { create, update } = useExpenseMutations(shopId);

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

  return (
    <Stack>
      <ExpenseForm zones={zones} onSubmit={add} />
      {isLoading ? <Text c="dimmed">Chargement…</Text> : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th><Table.Th>Description</Table.Th>
              <Table.Th>Montant</Table.Th><Table.Th>Reçu</Table.Th><Table.Th>Statut</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {expenses.map((e) => (
              <Table.Tr key={e.id}>
                <Table.Td>{new Date(e.spent_on).toLocaleDateString('fr-FR')}</Table.Td>
                <Table.Td>{e.description}</Table.Td>
                <Table.Td><MaskedAmount value={Number(e.amount)} revealed={revealed} /></Table.Td>
                <Table.Td>
                  {e.receipt_path ? (
                    <Anchor
                      component="button"
                      type="button"
                      size="sm"
                      onClick={async () => {
                        try {
                          const url = await getReceiptUrl(shopId, e.receipt_path!);
                          window.open(url, '_blank', 'noopener,noreferrer');
                        } catch (err) {
                          notifications.show({ color: 'red', message: (err as Error).message });
                        }
                      }}
                    >
                      📎 voir
                    </Anchor>
                  ) : (
                    <Badge color="orange" variant="light">manquant</Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  <Select
                    size="xs" variant="unstyled" allowDeselect={false}
                    data={Object.entries(STATUS_LABEL).map(([v, { label }]) => ({ value: v, label }))}
                    value={e.status}
                    onChange={(v) => v && update.mutate({ id: e.id, status: v })}
                    renderOption={({ option }) => <Badge color={STATUS_LABEL[option.value as ExpenseStatus].color} variant="light">{option.label}</Badge>}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
            {expenses.length === 0 && (
              <Table.Tr><Table.Td colSpan={5}><Text c="dimmed" ta="center">Aucune dépense.</Text></Table.Td></Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      )}
      <Group justify="flex-end">
        <Text size="sm" c="dimmed">Total :</Text>
        <MaskedAmount value={expenses.reduce((a, e) => a + Number(e.amount), 0)} revealed={revealed} />
      </Group>
    </Stack>
  );
}
