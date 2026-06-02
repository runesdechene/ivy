'use client';

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/**
 * Montant formaté quand `revealed`, sinon `••••• €`. Le style (police Fraunces,
 * couleur) est fourni par le parent via `className` — voir comptes.module.scss.
 */
export function MaskedAmount({ value, revealed, className }: { value: number; revealed: boolean; className?: string }) {
  return <span className={className}>{revealed ? EUR.format(value) : '••••• €'}</span>;
}
