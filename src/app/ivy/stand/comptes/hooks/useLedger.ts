'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hubJson, hubFetch } from '../api-client';
import type { Expense, CashMovement } from '../types';

// ----- Dépenses -----
export function useExpenses(shopId: string | undefined, studyZoneId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['hub-expenses', shopId, studyZoneId],
    enabled: !!shopId && enabled,
    queryFn: () => {
      const u = new URL('/api/hub/comptes/expenses', window.location.origin);
      u.searchParams.set('shopId', shopId!);
      if (studyZoneId) u.searchParams.set('studyZoneId', studyZoneId);
      return hubJson<{ expenses: Expense[] }>(u.pathname + u.search).then((r) => r.expenses);
    },
  });
}

export function useExpenseMutations(shopId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['hub-expenses', shopId] });
  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        hubJson<{ expense: Expense }>('/api/hub/comptes/expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, shopId }) }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        hubJson<{ expense: Expense }>('/api/hub/comptes/expenses', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, shopId }) }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => hubJson<{ ok: true }>(`/api/hub/comptes/expenses?id=${id}&shopId=${shopId}`, { method: 'DELETE' }),
      onSuccess: invalidate,
    }),
  };
}

// ----- Caisse (caisse globale, mouvements signés justifiés) -----
export function useCashLedger(shopId: string | undefined) {
  return useQuery({
    queryKey: ['hub-cash', shopId],
    enabled: !!shopId,
    queryFn: () => hubJson<{ balance: number; movements: CashMovement[] }>(`/api/hub/comptes/cash?shopId=${shopId}`),
  });
}

export function useCashMutations(shopId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['hub-cash', shopId] });
  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        hubJson<{ movement: CashMovement }>('/api/hub/comptes/cash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, shopId }) }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => hubJson<{ ok: true }>(`/api/hub/comptes/cash?id=${id}&shopId=${shopId}`, { method: 'DELETE' }),
      onSuccess: invalidate,
    }),
  };
}

// ----- Reçus -----
export async function uploadReceipt(shopId: string, file: File): Promise<string> {
  const fd = new FormData();
  fd.set('file', file);
  fd.set('shopId', shopId);
  const r = await hubFetch('/api/hub/comptes/receipts', { method: 'POST', body: fd });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || 'Upload échoué');
  return body.path as string;
}

export async function getReceiptUrl(shopId: string, path: string): Promise<string> {
  const r = await hubJson<{ url: string }>(`/api/hub/comptes/receipts?shopId=${shopId}&path=${encodeURIComponent(path)}`);
  return r.url;
}
