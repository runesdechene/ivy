'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export type ContainerInstance = {
  id: string;
  type: {
    id: string;
    name: string;
    max_capacity: number;
    empty_weight_g: number | null;
    ratio_w: number;
    ratio_h: number;
    columns: number;
  };
  products: { id: string; title: string; image_url: string | null; illustration_url: string | null }[];
  fill: { units: number; pct: number; weight_g: number | null };
  variants: { id: string; title: string; color: string | null; color_hex: string | null; qty: number }[];
};

export function useContainers(shopId: string | undefined, locationId: string | undefined) {
  return useQuery<ContainerInstance[]>({
    queryKey: ['containers', shopId, locationId],
    enabled: !!shopId && !!locationId,
    queryFn: async () => {
      const r = await fetch(`/api/inventory/containers?shopId=${shopId}&locationId=${locationId}`);
      if (!r.ok) throw new Error('fetch containers failed');
      const d = await r.json();
      return d.instances as ContainerInstance[];
    },
  });
}

export function useCreateContainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { shop_id: string; container_type_id: string; location_id: string; position?: number }) => {
      const r = await fetch('/api/inventory/containers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'create failed');
      return (await r.json()).instance;
    },
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ['containers', vars.shop_id, vars.location_id] }),
  });
}

export function useDeleteContainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/inventory/containers/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'delete failed');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['containers'] }),
  });
}

export function useSetContainerProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, productIds }: { id: string; productIds: string[] }) => {
      const r = await fetch(`/api/inventory/containers/${id}/products`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_ids: productIds }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'set products failed');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['containers'] }),
  });
}

export type ProductListItem = { id: string; title: string };

export function useShopProducts(shopId: string | undefined) {
  return useQuery<ProductListItem[]>({
    queryKey: ['shop-products-list', shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const r = await fetch(`/api/inventory/products-list?shopId=${shopId}`);
      if (!r.ok) throw new Error('fetch products failed');
      const d = await r.json();
      return d.products as ProductListItem[];
    },
  });
}
