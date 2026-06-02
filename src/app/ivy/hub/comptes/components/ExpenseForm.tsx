'use client';
import { useState } from 'react';
import { Button, FileButton, Group, NumberInput, Select, Stack, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';

interface Zone { id: string; name: string; }

export function ExpenseForm({ zones, onSubmit }: {
  zones: Zone[];
  onSubmit: (data: { amount: number; spentOn: string; description: string; studyZoneId: string | null; file: File | null }) => Promise<void>;
}) {
  const [amount, setAmount] = useState<number | string>('');
  const [spentOn, setSpentOn] = useState<string>(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (typeof amount !== 'number' || !spentOn) return;
    setBusy(true);
    try {
      await onSubmit({ amount, spentOn, description, studyZoneId: zoneId, file });
      setAmount(''); setDescription(''); setFile(null);
    } finally { setBusy(false); }
  };

  return (
    <Stack gap="sm">
      <Group grow>
        <NumberInput label="Montant (€)" value={amount} onChange={setAmount} min={0} decimalScale={2} thousandSeparator=" " />
        <DateInput label="Date" value={spentOn} onChange={(v) => setSpentOn(v ?? '')} valueFormat="DD/MM/YYYY" />
      </Group>
      <TextInput label="Description" value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
      <Select label="Festival" data={zones.map((z) => ({ value: z.id, label: z.name }))} value={zoneId} onChange={setZoneId} clearable searchable />
      <Group>
        <FileButton onChange={setFile} accept="image/*">
          {(props) => <Button variant="light" {...props}>{file ? file.name : 'Photo du reçu'}</Button>}
        </FileButton>
        <Button onClick={submit} loading={busy} disabled={typeof amount !== 'number'}>Ajouter</Button>
      </Group>
    </Stack>
  );
}
