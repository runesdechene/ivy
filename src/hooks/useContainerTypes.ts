'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export type ContainerType = {
  id: string;
  shop_id: string;
  name: string;
  max_capacity: number;
  empty_weight_g: number | null;
  ratio_w: number;
  ratio_h: number;
  columns: number;
  created_at: string;
};

export function useContainerTypes(shopId: string | undefined) {
  return useQuery<ContainerType[]>({
    queryKey: ['container-types', shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const r = await fetch(`/api/inventory/container-types?shopId=${shopId}`);
      if (!r.ok) throw new Error('fetch types failed');
      const d = await r.json();
      return d.types as ContainerType[];
    },
  });
}

export function useCreateContainerType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<ContainerType, 'id' | 'created_at'>) => {
      const r = await fetch('/api/inventory/container-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'create failed');
      return (await r.json()).type as ContainerType;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['container-types', variables.shop_id] });
    },
  });
}

export function useUpdateContainerType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<ContainerType>) => {
      const r = await fetch(`/api/inventory/container-types/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'update failed');
      return (await r.json()).type as ContainerType;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['container-types'] }),
  });
}

export function useDeleteContainerType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/inventory/container-types/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'delete failed');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['container-types'] }),
  });
}
