'use client';
import { useState } from 'react';
import { Button, PinInput, Stack, Text, Title } from '@mantine/core';

export function PinSetup({ onSubmit }: { onSubmit: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (pin.length < 4) return setErr('Le PIN doit faire au moins 4 chiffres.');
    if (pin !== confirm) return setErr('Les deux PIN ne correspondent pas.');
    setBusy(true); setErr('');
    try { await onSubmit(pin); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Stack align="center" gap="md" maw={360} mx="auto" mt="xl">
      <Title order={3}>Définir un code PIN</Title>
      <Text size="sm" c="dimmed" ta="center">Ce code protège l&apos;accès à tes comptes de stand. Il n&apos;est stocké que sous forme chiffrée (irrécupérable).</Text>
      <PinInput length={6} type="number" value={pin} onChange={setPin} aria-label="Nouveau PIN" />
      <PinInput length={6} type="number" value={confirm} onChange={setConfirm} aria-label="Confirmer le PIN" />
      {err && <Text c="red" size="sm">{err}</Text>}
      <Button onClick={submit} loading={busy} fullWidth>Enregistrer le PIN</Button>
    </Stack>
  );
}
