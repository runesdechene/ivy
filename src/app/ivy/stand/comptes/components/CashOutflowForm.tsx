'use client';
import { useState } from 'react';
import { Button, Group, NumberInput, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';

export function CashOutflowForm({ onSubmit }: {
  onSubmit: (d: { amount: number; spentOn: string; description: string }) => Promise<void>;
}) {
  const [amount, setAmount] = useState<number | string>('');
  const [spentOn, setSpentOn] = useState<string>(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (typeof amount !== 'number' || !spentOn) return;
    setBusy(true);
    try {
      await onSubmit({ amount, spentOn, description });
      setAmount(''); setDescription('');
    } finally { setBusy(false); }
  };

  return (
    <Group align="flex-end" grow>
      <NumberInput label="Sortie (€)" value={amount} onChange={setAmount} min={0} decimalScale={2} />
      <DateInput label="Date" value={spentOn} onChange={(v) => setSpentOn(v ?? '')} valueFormat="DD/MM/YYYY" />
      <TextInput label="Motif" value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
      <Button onClick={submit} loading={busy} color="#6b7a55" disabled={typeof amount !== 'number'}>Ajouter</Button>
    </Group>
  );
}
