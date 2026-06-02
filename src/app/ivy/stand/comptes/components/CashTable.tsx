'use client';
import { useState } from 'react';
import { ActionIcon, Alert, Button, Group, NumberInput, Select, Stack, Table, Text } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { IconTrash } from '@tabler/icons-react';
import { CashOutflowForm } from './CashOutflowForm';
import { MaskedAmount } from './MaskedAmount';
import { useCashSessions, useCashSessionMutations, useOutflows, useOutflowMutations } from '../hooks/useLedger';

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

  return (
    <Stack>
      <Select label="Festival (caisse)" data={sessions.map((s) => ({ value: s.id, label: `${s.opened_on} — ${zones.find((z) => z.id === s.study_zone_id)?.name ?? 'sans festival'}` }))}
        value={current?.id ?? null} onChange={setSelectedId} placeholder="Choisir une caisse" />

      <Alert variant="light" title="Ouvrir une nouvelle caisse">
        <Group align="flex-end" grow>
          <NumberInput label="Fond de caisse (€)" value={newFloat} onChange={setNewFloat} min={0} decimalScale={2} />
          <DateInput label="Date d'ouverture" value={newDate} onChange={(v) => setNewDate(v ?? '')} valueFormat="DD/MM/YYYY" />
          <Select label="Festival" data={zones.map((z) => ({ value: z.id, label: z.name }))} value={newZone} onChange={setNewZone} clearable searchable />
          <Button onClick={openSession} loading={createSession.isPending}>Ouvrir</Button>
        </Group>
      </Alert>

      {current && (
        <>
          <Group gap="lg">
            <Text size="sm">Fond : <MaskedAmount value={Number(current.opening_float)} revealed={revealed} /></Text>
            <Text size="sm">Sorties : <MaskedAmount value={Number(current.total_outflows)} revealed={revealed} /></Text>
            <Text size="sm" fw={700}>Solde : <MaskedAmount value={Number(current.balance)} revealed={revealed} c={current.balance < 0 ? 'red' : undefined} /></Text>
          </Group>
          {current.balance < 0 && <Alert color="red" variant="light">Solde négatif : plus de sorties que le fond de caisse.</Alert>}

          <CashOutflowForm onSubmit={async (d) => {
            try { await addOutflow.mutateAsync(d); notifications.show({ color: 'green', message: 'Sortie ajoutée.' }); }
            catch (e) { notifications.show({ color: 'red', message: (e as Error).message }); }
          }} />

          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr><Table.Th>Date</Table.Th><Table.Th>Motif</Table.Th><Table.Th>Montant</Table.Th><Table.Th /></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {outflows.map((o) => (
                <Table.Tr key={o.id}>
                  <Table.Td>{new Date(o.spent_on).toLocaleDateString('fr-FR')}</Table.Td>
                  <Table.Td>{o.description}</Table.Td>
                  <Table.Td><MaskedAmount value={Number(o.amount)} revealed={revealed} /></Table.Td>
                  <Table.Td><ActionIcon variant="subtle" color="red" onClick={() => removeOutflow.mutate(o.id)}><IconTrash size={16} /></ActionIcon></Table.Td>
                </Table.Tr>
              ))}
              {outflows.length === 0 && <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" ta="center">Aucune sortie.</Text></Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </>
      )}
    </Stack>
  );
}
