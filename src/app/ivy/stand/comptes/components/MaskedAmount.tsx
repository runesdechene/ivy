'use client';
import { Text } from '@mantine/core';

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

export function MaskedAmount({ value, revealed, c }: { value: number; revealed: boolean; c?: string }) {
  return <Text span fw={600} c={c}>{revealed ? EUR.format(value) : '••••• €'}</Text>;
}
