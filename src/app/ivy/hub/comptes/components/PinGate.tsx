'use client';
import { useState } from 'react';
import { Button, PinInput, Stack, Text, Title } from '@mantine/core';

export function PinGate({ onUnlock }: { onUnlock: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (value: string) => {
    setBusy(true); setErr('');
    try { await onUnlock(value); } catch (e) { setErr((e as Error).message); setPin(''); } finally { setBusy(false); }
  };

  return (
    <Stack align="center" gap="md" maw={320} mx="auto" mt="xl">
      <Title order={3}>Accès protégé</Title>
      <Text size="sm" c="dimmed">Saisis ton PIN pour afficher tes comptes.</Text>
      <PinInput length={6} type="number" value={pin} onChange={setPin} onComplete={submit} disabled={busy} aria-label="PIN" />
      {err && <Text c="red" size="sm">{err}</Text>}
      <Button onClick={() => submit(pin)} loading={busy} disabled={pin.length < 6} fullWidth>Déverrouiller</Button>
    </Stack>
  );
}
