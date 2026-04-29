'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface RefillVariant {
  variantId: string;
  title: string;
  sku: string | null;
  color: string | null;
  colorHex: string | null;
  size: string | null;
  currentInBox: number;
  currentAtLocation: number;
  soldInWindow: number;
  soldLifetime: number;
  suggestedQty: number;
}

export interface RefillProduct {
  productId: string;
  title: string;
  variants: RefillVariant[];
}

export interface RefillSuggestionsResponse {
  containerId: string;
  containerName: string;
  capacity: { max: number; current: number; pct: number };
  window: { type: 'days' | 'zone' | 'all'; label: string };
  products: RefillProduct[];
}

export type RefillWindow = '7d' | '30d' | 'all' | 'zone';

export function useRefillSuggestions(
  containerId: string | undefined,
  windowParam: RefillWindow,
  zoneId?: string | null,
  enabled: boolean = true,
) {
  return useQuery<RefillSuggestionsResponse>({
    queryKey: ['refill-suggestions', containerId, windowParam, zoneId],
    enabled: !!containerId && enabled && (windowParam !== 'zone' || !!zoneId),
    queryFn: async () => {
      const url = new URL(
        `/api/inventory/containers/${containerId}/refill-suggestions`,
        globalThis.location.origin,
      );
      url.searchParams.set('window', windowParam);
      if (windowParam === 'zone' && zoneId) url.searchParams.set('zoneId', zoneId);
      const r = await fetch(url.pathname + url.search);
      if (!r.ok) throw new Error('fetch suggestions failed');
      return r.json();
    },
  });
}

export interface RefillSubmitInput {
  containerId: string;
  shopId: string;
  orderId?: string;
  lines: Array<{ variantId: string; quantity: number }>;
}

export interface RefillSubmitResponse {
  orderId: string;
  orderNumber: string;
  linesAdded: number;
  linesIncremented: number;
  errors?: Array<{ variantId: string; reason: string }>;
}

export function useSubmitRefill() {
  const qc = useQueryClient();
  return useMutation<RefillSubmitResponse, Error, RefillSubmitInput>({
    mutationFn: async ({ containerId, ...body }) => {
      const r = await fetch(`/api/inventory/containers/${containerId}/refill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'submit refill failed');
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['containers'] });
      qc.invalidateQueries({ queryKey: ['supplier-orders'] });
      qc.invalidateQueries({ queryKey: ['refill-suggestions'] });
    },
  });
}
