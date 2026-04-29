# Caisses & Logistique — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une gestion de caisses physiques (types globaux + instances par emplacement) avec une page Logistique visuelle (style Tetris coloré) qui montre le remplissage en temps réel.

**Architecture :** 3 tables Supabase (`container_types`, `container_instances`, `container_instance_products`) + endpoints REST CRUD + 1 page Paramètres (CRUD types) + 1 page `/ivy/inventaire/logistique` (visu + affectation produits). Calcul remplissage côté API en partant de `products` et embed des variantes/inventory_levels (pattern existant `/api/inventory/stats`).

**Tech Stack :** Next.js 16 (App Router) + React 19 + Mantine 7 + Supabase + TanStack Query + SCSS modules + tokens Atelier boréal.

**Spec :** `docs/superpowers/specs/2026-04-29-caisses-logistique-design.md`

**Conventions importantes :**
- pnpm (jamais npm/yarn)
- TS strict (pas de `any`)
- `location_id` est le **Shopify location id (string)**, pas l'UUID Supabase (cf. cerebrum.md)
- Pas de query directe sur `inventory_levels` pour les totaux (limite PostgREST 1000 rows) — partir de `products`
- `.order('id')` obligatoire avant `.range(...)` si pagination
- Pas de framework de tests configuré : on fait des **smoke tests manuels** au lieu de TDD automatisé. Les "Step: Test" sont des vérifications manuelles dans le navigateur.
- Tokens Atelier boréal via `@/style/tokens` et mixins `@/style/typography`
- Après chaque commit important : `git push` + bump `APP_VERSION` patch (cf. memory `feedback_commit_push_bump.md`)

**Branche :** créer `feat/caisses-logistique` car migration multi-commits (cf. memory `feedback_feature_branch_for_big_migrations.md`)

---

## Phase 0 : Préparation

### Task 0.1 : Créer la branche

- [ ] **Step 1: Créer la branche feature**

```bash
git checkout -b feat/caisses-logistique
```

- [ ] **Step 2: Vérifier la branche**

```bash
git branch --show-current
```

Expected: `feat/caisses-logistique`

---

## Phase 1 : Migration DB

### Task 1.1 : Migration `041_containers.sql`

**Files:**
- Create: `supabase/migrations/041_containers.sql`

- [ ] **Step 1 : Écrire la migration**

```sql
-- Containers (caisses physiques) - types globaux + instances par emplacement
CREATE TABLE IF NOT EXISTS container_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  max_capacity INTEGER NOT NULL CHECK (max_capacity > 0),
  empty_weight_g INTEGER,
  ratio_w SMALLINT NOT NULL DEFAULT 1 CHECK (ratio_w > 0),
  ratio_h SMALLINT NOT NULL DEFAULT 1 CHECK (ratio_h > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_container_types_shop ON container_types(shop_id);

CREATE TABLE IF NOT EXISTS container_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  container_type_id UUID NOT NULL REFERENCES container_types(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL, -- Shopify location id (cf. inventory_levels.location_id)
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_container_instances_shop_loc ON container_instances(shop_id, location_id);

CREATE TABLE IF NOT EXISTS container_instance_products (
  container_instance_id UUID NOT NULL REFERENCES container_instances(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (container_instance_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_cip_product ON container_instance_products(product_id);

-- RLS
ALTER TABLE container_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE container_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE container_instance_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage container_types for their shops"
  ON container_types FOR ALL
  USING (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage container_instances for their shops"
  ON container_instances FOR ALL
  USING (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage container_instance_products via instance access"
  ON container_instance_products FOR ALL
  USING (
    container_instance_id IN (
      SELECT id FROM container_instances
      WHERE shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid())
    )
  );

COMMENT ON COLUMN container_instances.location_id IS
  'Shopify location id (string, not the Supabase locations.id UUID). Aligns with inventory_levels.location_id.';
```

- [ ] **Step 2 : Appliquer la migration via le dashboard Supabase OU CLI**

Demander à l'utilisateur d'exécuter le SQL via le dashboard Supabase (SQL editor → coller le contenu de `041_containers.sql` → Run). Pas de CLI Supabase configurée dans ce projet.

- [ ] **Step 3 : Vérifier la création**

Sur le dashboard Supabase → Table editor → vérifier la présence des 3 tables : `container_types`, `container_instances`, `container_instance_products`.

- [ ] **Step 4 : Commit**

```bash
git add supabase/migrations/041_containers.sql
git commit -m "feat(db): migration 041 — tables container_types/instances/instance_products"
```

### Task 1.2 : Ajouter `weight_g` sur `product_variants` (optionnel, si la colonne n'existe pas)

**Files:**
- Create: `supabase/migrations/042_variant_weight.sql`

- [ ] **Step 1 : Vérifier d'abord l'existence de la colonne**

Demander à l'utilisateur ou inspecter `supabase/schema.sql` et migrations 005-040 :

```bash
grep -i "weight" supabase/migrations/*.sql supabase/schema*.sql
```

Si la colonne `weight_g` (ou `weight`) existe déjà → **skip cette task entière**.

- [ ] **Step 2 : Si absente, créer la migration**

```sql
-- Poids unitaire des variantes (synced from Shopify variant weight, en grammes)
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS weight_g INTEGER;

COMMENT ON COLUMN product_variants.weight_g IS
  'Poids unitaire en grammes, synchronisé depuis Shopify (variant.weight × 1000 si unit=kg). NULL = non synchronisé.';
```

- [ ] **Step 3 : Appliquer + commit**

```bash
git add supabase/migrations/042_variant_weight.sql
git commit -m "feat(db): migration 042 — ajouter weight_g sur product_variants"
```

- [ ] **Step 4 : Hookup sync (best effort, sinon V2)**

Dans `src/app/api/inventory/sync-stream/route.ts`, ajouter le mapping du poids Shopify si déjà fetched. Le champ Shopify GraphQL est `variant.weight` (number) avec `weightUnit` (`KILOGRAMS`/`GRAMS`/...). Convertir en grammes (round). Si la query GraphQL ne fetch pas déjà le poids, **noter pour V2** et passer.

```ts
// dans la transformation variante avant upsert :
weight_g: shopifyVariant.weight != null
  ? Math.round(
      shopifyVariant.weightUnit === 'KILOGRAMS'
        ? shopifyVariant.weight * 1000
        : shopifyVariant.weight
    )
  : null,
```

Si non hooké, dégrader proprement côté API logistique (voir Task 2.3).

---

## Phase 2 : API endpoints

### Task 2.1 : `container-types` CRUD

**Files:**
- Create: `src/app/api/inventory/container-types/route.ts`
- Create: `src/app/api/inventory/container-types/[id]/route.ts`

- [ ] **Step 1 : Écrire `route.ts` (GET + POST)**

```ts
// src/app/api/inventory/container-types/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get('shopId');
  if (!shopId) return NextResponse.json({ error: 'shopId required' }, { status: 400 });

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('container_types')
    .select('*')
    .eq('shop_id', shopId)
    .order('name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ types: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { shop_id, name, max_capacity, empty_weight_g, ratio_w, ratio_h } = body;
  if (!shop_id || !name || !max_capacity) {
    return NextResponse.json({ error: 'shop_id, name, max_capacity required' }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('container_types')
    .insert({
      shop_id,
      name,
      max_capacity,
      empty_weight_g: empty_weight_g ?? null,
      ratio_w: ratio_w ?? 1,
      ratio_h: ratio_h ?? 1,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ type: data });
}
```

- [ ] **Step 2 : Écrire `[id]/route.ts` (PUT + DELETE)**

```ts
// src/app/api/inventory/container-types/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const supabase = await createServerClient();

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.max_capacity !== undefined) updates.max_capacity = body.max_capacity;
  if (body.empty_weight_g !== undefined) updates.empty_weight_g = body.empty_weight_g;
  if (body.ratio_w !== undefined) updates.ratio_w = body.ratio_w;
  if (body.ratio_h !== undefined) updates.ratio_h = body.ratio_h;

  const { data, error } = await supabase
    .from('container_types')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ type: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerClient();

  // Vérifier qu'il n'y a pas d'instances utilisant ce type
  const { count, error: cErr } = await supabase
    .from('container_instances')
    .select('id', { head: true, count: 'exact' })
    .eq('container_type_id', id);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: 'Type utilisé par des instances actives.' }, { status: 409 });
  }

  const { error } = await supabase.from('container_types').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3 : Smoke test manuel via DevTools**

```js
// Dans la console navigateur sur un onglet Ivy authentifié :
fetch('/api/inventory/container-types?shopId=<UUID>').then(r => r.json()).then(console.log);
```

Expected: `{ types: [] }` (200).

- [ ] **Step 4 : Commit**

```bash
git add src/app/api/inventory/container-types
git commit -m "feat(api): CRUD container-types"
```

### Task 2.2 : `containers` CRUD instances

**Files:**
- Create: `src/app/api/inventory/containers/route.ts`
- Create: `src/app/api/inventory/containers/[id]/route.ts`
- Create: `src/app/api/inventory/containers/[id]/products/route.ts`

- [ ] **Step 1 : Écrire `route.ts` (GET + POST)**

```ts
// src/app/api/inventory/containers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

type VariantInfo = {
  id: string;
  title: string;
  color: string | null;
  qty: number;
  weight_g: number | null;
};

type InstanceResp = {
  id: string;
  type: {
    id: string;
    name: string;
    max_capacity: number;
    empty_weight_g: number | null;
    ratio_w: number;
    ratio_h: number;
  };
  products: { id: string; title: string; illustration_url: string | null }[];
  fill: { units: number; pct: number; weight_g: number | null };
  variants: VariantInfo[];
};

export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get('shopId');
  const locationId = req.nextUrl.searchParams.get('locationId');
  if (!shopId || !locationId) {
    return NextResponse.json({ error: 'shopId & locationId required' }, { status: 400 });
  }

  const supabase = await createServerClient();

  // 1. Fetch instances + type + product affectations + product info
  const { data: instances, error: iErr } = await supabase
    .from('container_instances')
    .select(`
      id,
      type:container_types(id, name, max_capacity, empty_weight_g, ratio_w, ratio_h),
      affectations:container_instance_products(
        product:products(id, title, illustration_url, shopify_id)
      )
    `)
    .eq('shop_id', shopId)
    .eq('location_id', locationId)
    .order('position', { ascending: true });

  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  // 2. Pour chaque instance, calculer le remplissage en partant de products
  //    et embed product_variants → inventory_levels filtré par locationId
  const result: InstanceResp[] = [];
  for (const inst of instances ?? []) {
    const products = (inst.affectations ?? [])
      .map((a: any) => a.product)
      .filter(Boolean);
    const productIds = products.map((p: any) => p.id);

    let variants: VariantInfo[] = [];
    let units = 0;
    let weightSum = 0;
    let hasWeight = true;

    if (productIds.length > 0) {
      const { data: prodWithVariants, error: vErr } = await supabase
        .from('products')
        .select(`
          id,
          variants:product_variants(
            id,
            title,
            color,
            weight_g,
            inventory_levels(available, location_id)
          )
        `)
        .in('id', productIds);

      if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

      for (const p of prodWithVariants ?? []) {
        for (const v of (p.variants ?? []) as any[]) {
          const lvl = (v.inventory_levels ?? []).find((l: any) => String(l.location_id) === String(locationId));
          const qty = lvl?.available ?? 0;
          if (qty <= 0) continue;
          variants.push({
            id: v.id,
            title: v.title,
            color: v.color ?? null,
            qty,
            weight_g: v.weight_g ?? null,
          });
          units += qty;
          if (v.weight_g != null) weightSum += qty * v.weight_g;
          else hasWeight = false;
        }
      }
    }

    const type = Array.isArray(inst.type) ? inst.type[0] : inst.type;
    const max = type?.max_capacity ?? 1;
    const pct = Math.min(100, Math.round((units / max) * 100));
    const weightTotal =
      type?.empty_weight_g != null && hasWeight
        ? type.empty_weight_g + weightSum
        : null;

    result.push({
      id: inst.id,
      type: {
        id: type.id,
        name: type.name,
        max_capacity: type.max_capacity,
        empty_weight_g: type.empty_weight_g,
        ratio_w: type.ratio_w,
        ratio_h: type.ratio_h,
      },
      products: products.map((p: any) => ({
        id: p.id,
        title: p.title,
        illustration_url: p.illustration_url ?? null,
      })),
      fill: { units, pct, weight_g: weightTotal },
      variants,
    });
  }

  return NextResponse.json({ instances: result });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { shop_id, container_type_id, location_id, position } = body;
  if (!shop_id || !container_type_id || !location_id) {
    return NextResponse.json({ error: 'shop_id, container_type_id, location_id required' }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('container_instances')
    .insert({ shop_id, container_type_id, location_id: String(location_id), position: position ?? 0 })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ instance: data });
}
```

⚠️ **Note importante** : `v.color` est utilisé ici comme champ de variante. Vérifier que `product_variants` a bien une colonne `color` (extraite des options Shopify). Sinon, il faut soit la lire depuis une autre source (ex: `option1`/`option2` selon `product_option_names`), soit utiliser `variant-helpers.ts::getColorFromVariant()`. Si pas de colonne directe, **adapter** : faire la résolution côté front via `useProducts`/`color-transformer`.

- [ ] **Step 2 : Écrire `[id]/route.ts` (DELETE)**

```ts
// src/app/api/inventory/containers/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { error } = await supabase.from('container_instances').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3 : Écrire `[id]/products/route.ts` (PUT — remplace l'ensemble)**

```ts
// src/app/api/inventory/containers/[id]/products/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const productIds: string[] = Array.isArray(body.product_ids) ? body.product_ids : [];

  const supabase = await createServerClient();

  // delete-all then insert (atomic logique côté app, pas de transaction RPC ici)
  const { error: dErr } = await supabase
    .from('container_instance_products')
    .delete()
    .eq('container_instance_id', id);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  if (productIds.length > 0) {
    const rows = productIds.map((pid) => ({ container_instance_id: id, product_id: pid }));
    const { error: iErr } = await supabase.from('container_instance_products').insert(rows);
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, count: productIds.length });
}
```

- [ ] **Step 4 : Smoke test (sans data)**

```js
fetch('/api/inventory/containers?shopId=<UUID>&locationId=<SHOPIFY_LOC_ID>').then(r => r.json()).then(console.log);
```

Expected: `{ instances: [] }` (200).

- [ ] **Step 5 : Commit**

```bash
git add src/app/api/inventory/containers
git commit -m "feat(api): CRUD container instances + affectation produits"
```

### Task 2.3 : Vérifier la colonne `color` sur `product_variants`

- [ ] **Step 1 : Inspecter le schéma**

```bash
grep -i "color" supabase/migrations/*.sql supabase/schema*.sql | grep -i "variant"
```

- [ ] **Step 2 : Si `product_variants.color` n'existe pas**

Adapter Task 2.1 Step 1 pour fournir `option1`/`option2`/`option3` + `product.option_names` au front, qui résoudra la couleur via `getColorFromVariant()` (voir `src/utils/variant-helpers.ts`). Refactor :

- Réponse API renvoie `variants: [{ id, title, options: { Couleur: "Mocha", Taille: "M" }, qty, weight_g }]`
- Le champ `color` est extrait côté front via `useProducts` ou directement d'`options`.

Sinon **OK pour utiliser `color` direct**.

---

## Phase 3 : Hooks TanStack Query

### Task 3.1 : `useContainerTypes` + `useContainers`

**Files:**
- Create: `src/hooks/useContainerTypes.ts`
- Create: `src/hooks/useContainers.ts`

- [ ] **Step 1 : `useContainerTypes.ts`**

```ts
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
```

- [ ] **Step 2 : `useContainers.ts`**

```ts
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
  };
  products: { id: string; title: string; illustration_url: string | null }[];
  fill: { units: number; pct: number; weight_g: number | null };
  variants: { id: string; title: string; color: string | null; qty: number; weight_g: number | null }[];
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
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['containers', vars.shop_id, vars.location_id] }),
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
```

- [ ] **Step 3 : Commit**

```bash
git add src/hooks/useContainerTypes.ts src/hooks/useContainers.ts
git commit -m "feat(hooks): useContainerTypes + useContainers (TanStack Query)"
```

---

## Phase 4 : Page Paramètres `/parametres/conteneurs`

### Task 4.1 : Ajouter l'entrée sidebar Paramètres

**Files:**
- Modify: `src/layout/ParametresLayout.tsx`

- [ ] **Step 1 : Ajouter l'icône import + entrée menu**

Dans `ParametresLayout.tsx`, modifier la ligne d'import des icônes :

```tsx
import { IconPalette, IconTag, IconShoppingCart, IconCurrencyEuro, IconFileDescription, IconPhoto, IconBox } from '@tabler/icons-react';
```

Et ajouter l'entrée dans `menuCategories[0].items` (après Illustrations) :

```tsx
{
  href: '/parametres/conteneurs',
  label: 'Conteneurs',
  icon: IconBox,
},
```

- [ ] **Step 2 : Smoke test : recharger l'app, voir « Conteneurs » dans la sidebar Paramètres**

Lien doit apparaître (404 attendu pour l'instant).

### Task 4.2 : Page CRUD types

**Files:**
- Create: `src/app/parametres/conteneurs/page.tsx`
- Create: `src/app/parametres/conteneurs/conteneurs.module.scss`

- [ ] **Step 1 : SCSS module**

```scss
// conteneurs.module.scss
@use '@/style/tokens';
@use '@/style/typography';

.page { padding: 24px; max-width: 960px; }
.title { @include typography.type-display; margin-bottom: 24px; }
.empty { padding: 32px; text-align: center; opacity: .6; }

.list { display: flex; flex-direction: column; gap: 12px; }
.row {
  display: grid;
  grid-template-columns: 80px 1fr 100px 120px 100px auto;
  gap: 12px;
  align-items: center;
  padding: 12px 16px;
  background: var(--color-cream-soft);
  border-radius: 8px;
}
.preview {
  background: var(--color-moss-soft);
  border-radius: 4px;
  display: block;
}
.actions { display: flex; gap: 8px; }
.toolbar { display: flex; justify-content: flex-end; margin-bottom: 16px; }
```

- [ ] **Step 2 : Page**

```tsx
// src/app/parametres/conteneurs/page.tsx
'use client';

import { useState } from 'react';
import { ParametresLayout } from '@/layout/ParametresLayout';
import { useShop } from '@/context/ShopContext';
import {
  useContainerTypes,
  useCreateContainerType,
  useUpdateContainerType,
  useDeleteContainerType,
  type ContainerType,
} from '@/hooks/useContainerTypes';
import { Button, Modal, NumberInput, TextInput, Group, Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconPencil, IconTrash } from '@tabler/icons-react';
import styles from './conteneurs.module.scss';

type FormState = {
  name: string;
  max_capacity: number;
  empty_weight_g: number | null;
  ratio_w: number;
  ratio_h: number;
};

const EMPTY: FormState = { name: '', max_capacity: 70, empty_weight_g: null, ratio_w: 1, ratio_h: 1 };

export default function ConteneursPage() {
  const { currentShop } = useShop();
  const { data: types = [], isLoading } = useContainerTypes(currentShop?.id);
  const createMut = useCreateContainerType();
  const updateMut = useUpdateContainerType();
  const deleteMut = useDeleteContainerType();

  const [editing, setEditing] = useState<ContainerType | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);

  const open = (t: ContainerType | null) => {
    if (t) {
      setEditing(t);
      setForm({
        name: t.name,
        max_capacity: t.max_capacity,
        empty_weight_g: t.empty_weight_g,
        ratio_w: t.ratio_w,
        ratio_h: t.ratio_h,
      });
    } else {
      setEditing(null);
      setCreating(true);
      setForm(EMPTY);
    }
  };

  const close = () => {
    setEditing(null);
    setCreating(false);
  };

  const submit = async () => {
    if (!currentShop) return;
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, ...form });
        notifications.show({ title: 'Mis à jour', message: form.name, color: 'moss' });
      } else {
        await createMut.mutateAsync({ shop_id: currentShop.id, ...form });
        notifications.show({ title: 'Créé', message: form.name, color: 'moss' });
      }
      close();
    } catch (e) {
      notifications.show({ title: 'Erreur', message: (e as Error).message, color: 'rust' });
    }
  };

  const remove = async (t: ContainerType) => {
    if (!confirm(`Supprimer le type « ${t.name} » ?`)) return;
    try {
      await deleteMut.mutateAsync(t.id);
      notifications.show({ title: 'Supprimé', message: t.name, color: 'moss' });
    } catch (e) {
      notifications.show({ title: 'Erreur', message: (e as Error).message, color: 'rust' });
    }
  };

  const isOpen = creating || !!editing;

  return (
    <ParametresLayout>
      <div className={styles.page}>
        <h1 className={styles.title}>Types de conteneurs</h1>
        <div className={styles.toolbar}>
          <Button leftSection={<IconPlus size={14} />} onClick={() => open(null)}>
            Nouveau type
          </Button>
        </div>

        {isLoading ? (
          <div className={styles.empty}>Chargement…</div>
        ) : types.length === 0 ? (
          <div className={styles.empty}>Aucun type. Crée ta première caisse.</div>
        ) : (
          <div className={styles.list}>
            {types.map((t) => (
              <div key={t.id} className={styles.row}>
                <span
                  className={styles.preview}
                  style={{ width: 24 * t.ratio_w, height: 24 * t.ratio_h }}
                  aria-label={`${t.ratio_w}×${t.ratio_h}`}
                />
                <strong>{t.name}</strong>
                <span>cap. {t.max_capacity}</span>
                <span>{t.empty_weight_g != null ? `${t.empty_weight_g} g vide` : '— g'}</span>
                <span>{t.ratio_w}×{t.ratio_h}</span>
                <div className={styles.actions}>
                  <Button size="xs" variant="subtle" onClick={() => open(t)} leftSection={<IconPencil size={12} />}>Éditer</Button>
                  <Button size="xs" variant="subtle" color="rust" onClick={() => remove(t)} leftSection={<IconTrash size={12} />}>Supprimer</Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Modal opened={isOpen} onClose={close} title={editing ? 'Éditer le type' : 'Nouveau type'} centered>
          <Stack>
            <TextInput
              label="Nom"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
              required
            />
            <NumberInput
              label="Capacité max (unités)"
              value={form.max_capacity}
              onChange={(v) => setForm({ ...form, max_capacity: typeof v === 'number' ? v : 1 })}
              min={1}
              required
            />
            <NumberInput
              label="Poids à vide (g)"
              value={form.empty_weight_g ?? ''}
              onChange={(v) => setForm({ ...form, empty_weight_g: typeof v === 'number' ? v : null })}
              min={0}
            />
            <Group grow>
              <NumberInput
                label="Ratio largeur"
                value={form.ratio_w}
                onChange={(v) => setForm({ ...form, ratio_w: typeof v === 'number' ? v : 1 })}
                min={1}
                max={5}
              />
              <NumberInput
                label="Ratio hauteur"
                value={form.ratio_h}
                onChange={(v) => setForm({ ...form, ratio_h: typeof v === 'number' ? v : 1 })}
                min={1}
                max={5}
              />
            </Group>
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>Annuler</Button>
              <Button onClick={submit} loading={createMut.isPending || updateMut.isPending}>
                Enregistrer
              </Button>
            </Group>
          </Stack>
        </Modal>
      </div>
    </ParametresLayout>
  );
}
```

- [ ] **Step 3 : Smoke test**

`pnpm dev` → naviguer vers `/parametres/conteneurs` → créer un type « Caisse Tshirt » (cap 70, poids 350, 1×1) → vérifier qu'il apparaît dans la liste → éditer → supprimer.

- [ ] **Step 4 : Commit**

```bash
git add src/app/parametres/conteneurs src/layout/ParametresLayout.tsx
git commit -m "feat(parametres): page conteneurs (CRUD types globaux)"
```

---

## Phase 5 : Page Logistique

### Task 5.1 : Ajouter l'entrée sidebar Inventaire

**Files:**
- Modify: `src/layout/IvyLayout.tsx`

- [ ] **Step 1 : Ajouter l'icône + entrée**

Modifier l'import des icônes pour inclure `IconBox` :

```tsx
import { IconHome, IconPackage, IconTruck, IconChartBar, IconShoppingCart, IconFileInvoice, IconArchive, IconRefresh, IconChecklist, IconChartPie, IconBox } from '@tabler/icons-react';
```

Et dans `inventaireMenu[0].items`, ajouter (après Statistiques) :

```tsx
{ href: '/ivy/inventaire/logistique', label: 'Logistique', icon: IconBox },
```

- [ ] **Step 2 : Smoke test**

Recharger, naviguer vers Inventaire → l'entrée « Logistique » est visible (404 attendu).

### Task 5.2 : Page Logistique — squelette

**Files:**
- Create: `src/app/ivy/inventaire/logistique/page.tsx`
- Create: `src/app/ivy/inventaire/logistique/logistique.module.scss`

- [ ] **Step 1 : SCSS de base**

```scss
// logistique.module.scss
@use '@/style/tokens';
@use '@/style/typography';

.page { padding: 24px; }
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}
.title { @include typography.type-display; }
.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}
.counters {
  display: flex;
  gap: 12px;
  font-size: 12px;
  opacity: .7;
}

.grid {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  align-items: flex-start;
}

.empty { padding: 48px; text-align: center; opacity: .6; }
```

- [ ] **Step 2 : Page squelette (sans cartes encore)**

```tsx
// src/app/ivy/inventaire/logistique/page.tsx
'use client';

import { useMemo, useState } from 'react';
import { IvyLayout } from '@/layout/IvyLayout';
import { useShop } from '@/context/ShopContext';
import { useLocation } from '@/context/LocationContext';
import { useContainers } from '@/hooks/useContainers';
import { useContainerTypes } from '@/hooks/useContainerTypes';
import { Button } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import styles from './logistique.module.scss';
import { ContainerCard } from '@/components/Logistique/ContainerCard';
import { AddContainerModal } from '@/components/Logistique/AddContainerModal';
import { AssignProductsModal } from '@/components/Logistique/AssignProductsModal';

export default function LogistiquePage() {
  const { currentShop } = useShop();
  const { currentLocation } = useLocation();
  const locationId = currentLocation?.id;
  const { data: instances = [], isLoading } = useContainers(currentShop?.id, locationId);
  const { data: types = [] } = useContainerTypes(currentShop?.id);

  const [adding, setAdding] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const counters = useMemo(() => {
    const map = new Map<string, number>();
    for (const inst of instances) {
      map.set(inst.type.name, (map.get(inst.type.name) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  }, [instances]);

  return (
    <IvyLayout>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>Logistique — {currentLocation?.name ?? '—'}</h1>
        </div>

        <div className={styles.toolbar}>
          <Button leftSection={<IconPlus size={14} />} onClick={() => setAdding(true)} disabled={!locationId}>
            Ajouter un conteneur
          </Button>
          <div className={styles.counters}>
            {counters.map((c) => (
              <span key={c.name}>{c.count} × {c.name}</span>
            ))}
          </div>
        </div>

        {!locationId ? (
          <div className={styles.empty}>Sélectionne un emplacement.</div>
        ) : isLoading ? (
          <div className={styles.empty}>Chargement…</div>
        ) : instances.length === 0 ? (
          <div className={styles.empty}>Aucun conteneur ici. Ajoute-en un.</div>
        ) : (
          <div className={styles.grid}>
            {instances.map((inst) => (
              <ContainerCard key={inst.id} instance={inst} onAssign={() => setAssigningId(inst.id)} />
            ))}
          </div>
        )}

        {adding && currentShop && locationId && (
          <AddContainerModal
            opened={adding}
            onClose={() => setAdding(false)}
            shopId={currentShop.id}
            locationId={locationId}
            existingTypes={types}
          />
        )}

        {assigningId && (
          <AssignProductsModal
            opened={!!assigningId}
            onClose={() => setAssigningId(null)}
            instance={instances.find((i) => i.id === assigningId)!}
            shopId={currentShop?.id ?? ''}
          />
        )}
      </div>
    </IvyLayout>
  );
}
```

⚠️ **Note** : `useLocation` est exporté depuis `@/context/LocationContext`. Vérifier la signature exacte (export `useLocation()` qui renvoie `{ currentLocation: { id, name } }`). Adapter si différent.

- [ ] **Step 3 : Smoke test (broken)**

Aller sur `/ivy/inventaire/logistique` — la page va planter à l'import des composants `ContainerCard`/`AddContainerModal`/`AssignProductsModal` qui n'existent pas encore. C'est attendu, on les crée à la prochaine task.

### Task 5.3 : Composant `ContainerCard` (visu Tetris)

**Files:**
- Create: `src/components/Logistique/ContainerCard.tsx`
- Create: `src/components/Logistique/ContainerCard.module.scss`

- [ ] **Step 1 : SCSS**

```scss
// ContainerCard.module.scss
@use '@/style/tokens';
@use '@/style/typography';

$unit: 140px;

.card {
  position: relative;
  background: var(--color-cream-soft);
  border: 1px solid var(--color-moss-soft);
  border-radius: 12px;
  box-shadow: 0 2px 6px rgba(0,0,0,.05);
  padding: 12px;
  cursor: pointer;
  transition: box-shadow .15s;
  display: flex;
  flex-direction: column;
  gap: 8px;

  &:hover { box-shadow: 0 4px 12px rgba(0,0,0,.1); }
}

.box {
  position: relative;
  width: 100%;
  background: var(--color-cream);
  border: 1px solid var(--color-moss-soft);
  border-radius: 6px;
  overflow: hidden;
}

.fill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-wrap: wrap-reverse;
  align-content: flex-start;
  align-items: stretch;
}

.block {
  flex-shrink: 0;
  border-right: 1px solid rgba(0,0,0,.05);
  border-top: 1px solid rgba(0,0,0,.05);
}

.weatherBadge {
  position: absolute;
  top: 6px;
  left: 6px;
  font-size: 18px;
  z-index: 2;
}

.statBadge {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(255,255,255,.85);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  z-index: 2;
}

.footer {
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.title { @include typography.type-eyebrow; }
.products { opacity: .8; }
.empty { opacity: .5; font-style: italic; }

.menu {
  position: absolute;
  bottom: 8px;
  right: 8px;
  z-index: 3;
}
```

- [ ] **Step 2 : Composant**

```tsx
// src/components/Logistique/ContainerCard.tsx
'use client';

import { useMemo } from 'react';
import clsx from 'clsx';
import { ActionIcon, Menu, Tooltip } from '@mantine/core';
import { IconDots, IconTrash } from '@tabler/icons-react';
import type { ContainerInstance } from '@/hooks/useContainers';
import { useDeleteContainer } from '@/hooks/useContainers';
import styles from './ContainerCard.module.scss';

const UNIT = 140;

const COLOR_FALLBACKS: Record<string, string> = {
  Mocha: '#6f4a36',
  Chocolat: '#6f4a36',
  Black: '#2a2a2a',
  Noir: '#2a2a2a',
  White: '#f4f1ea',
  Blanc: '#f4f1ea',
  Cream: '#efe6d4',
  Crème: '#efe6d4',
  Sand: '#d8c8a8',
  Sable: '#d8c8a8',
  'French Navy': '#1f2c4d',
  'Bleu Marine': '#1f2c4d',
  Rust: '#a85a3a',
  Rouille: '#a85a3a',
  Moss: '#7a8a4a',
  Mousse: '#7a8a4a',
};

function colorToCss(color: string | null | undefined): string {
  if (!color) return '#cdcdcd';
  if (COLOR_FALLBACKS[color]) return COLOR_FALLBACKS[color];
  // Si la string ressemble à un hex, l'utiliser
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  return '#cdcdcd';
}

function weatherEmoji(pct: number): { emoji: string; label: string } {
  if (pct >= 70) return { emoji: '☀️', label: 'Bien rempli' };
  if (pct >= 40) return { emoji: '☁️', label: 'À surveiller' };
  return { emoji: '⛈️', label: 'À recommander' };
}

interface Props {
  instance: ContainerInstance;
  onAssign: () => void;
}

export function ContainerCard({ instance, onAssign }: Props) {
  const { type, fill, variants, products } = instance;
  const deleteMut = useDeleteContainer();

  // Tetris : pour chaque variante, un bloc de surface ∝ qty/max
  // Layout simple : on calcule la hauteur de remplissage globale, et on partage en blocs largeur ∝ qty
  const blocks = useMemo(() => {
    if (variants.length === 0 || fill.units === 0) return [];
    const fillRatio = Math.min(1, fill.units / type.max_capacity);
    return variants.map((v) => ({
      key: v.id,
      title: v.title,
      qty: v.qty,
      color: colorToCss(v.color),
      flexGrow: v.qty,
      heightPct: fillRatio * 100,
    }));
  }, [variants, fill.units, type.max_capacity]);

  const w = UNIT * type.ratio_w;
  const h = UNIT * type.ratio_h;
  const weather = weatherEmoji(fill.pct);

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-noprop="true"]')) return;
    onAssign();
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Retirer cette caisse "${type.name}" ?`)) return;
    await deleteMut.mutateAsync(instance.id);
  };

  return (
    <div className={styles.card} style={{ width: w + 24 }} onClick={handleCardClick} role="button" tabIndex={0}>
      <div className={styles.box} style={{ width: w, height: h }}>
        <Tooltip label={weather.label}><span className={styles.weatherBadge}>{weather.emoji}</span></Tooltip>
        <span className={styles.statBadge}>
          {fill.pct}%{fill.weight_g != null ? ` · ${(fill.weight_g / 1000).toFixed(1)} kg` : ''}
        </span>
        <div className={styles.fill} style={{ height: `${Math.min(100, fill.pct)}%` }}>
          {blocks.map((b) => (
            <Tooltip key={b.key} label={`${b.title} — ${b.qty}`}>
              <div
                className={styles.block}
                style={{
                  flexGrow: b.flexGrow,
                  background: b.color,
                  height: '100%',
                  minWidth: 8,
                }}
              />
            </Tooltip>
          ))}
        </div>

        <div data-noprop="true" className={styles.menu}>
          <Menu>
            <Menu.Target>
              <ActionIcon variant="subtle" size="sm" onClick={(e) => e.stopPropagation()}>
                <IconDots size={14} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={handleDelete}>
                Retirer la caisse
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>

      <div className={styles.footer}>
        <span className={styles.title}>{type.name}</span>
        {products.length > 0 ? (
          <span className={styles.products}>{products.map((p) => p.title).join(' · ')}</span>
        ) : (
          <span className={clsx(styles.products, styles.empty)}>Aucun produit affecté</span>
        )}
      </div>
    </div>
  );
}
```

⚠️ **Note importante sur les couleurs** : `COLOR_FALLBACKS` est un mapping local minimal. Pour une couverture complète, importer `loadColorMappings()` depuis `@/utils/color-transformer` si possible (cf. spec § Couleurs des variantes), ou faire un fetch des `color_rules` Supabase. Pour V1 de cette story, le fallback statique suffit ; l'amélioration peut être un follow-up. Si plus de temps disponible, faire un hook `useColorMappings()` et l'utiliser ici.

- [ ] **Step 3 : Commit**

```bash
git add src/components/Logistique/ContainerCard.tsx src/components/Logistique/ContainerCard.module.scss
git commit -m "feat(logistique): ContainerCard (visu Tetris + badges météo)"
```

### Task 5.4 : Modal « Ajouter un conteneur »

**Files:**
- Create: `src/components/Logistique/AddContainerModal.tsx`

- [ ] **Step 1 : Composant**

```tsx
// src/components/Logistique/AddContainerModal.tsx
'use client';

import { useState } from 'react';
import { Modal, Tabs, Stack, Select, Button, TextInput, NumberInput, Group } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  type ContainerType,
  useCreateContainerType,
} from '@/hooks/useContainerTypes';
import { useCreateContainer } from '@/hooks/useContainers';

interface Props {
  opened: boolean;
  onClose: () => void;
  shopId: string;
  locationId: string;
  existingTypes: ContainerType[];
}

export function AddContainerModal({ opened, onClose, shopId, locationId, existingTypes }: Props) {
  const [tab, setTab] = useState<string | null>('existing');
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const createInstance = useCreateContainer();
  const createType = useCreateContainerType();

  const [form, setForm] = useState({ name: '', max_capacity: 70, empty_weight_g: null as number | null, ratio_w: 1, ratio_h: 1 });

  const addExisting = async () => {
    if (!selectedTypeId) return;
    try {
      await createInstance.mutateAsync({
        shop_id: shopId,
        container_type_id: selectedTypeId,
        location_id: locationId,
      });
      notifications.show({ title: 'Conteneur ajouté', message: '', color: 'moss' });
      onClose();
    } catch (e) {
      notifications.show({ title: 'Erreur', message: (e as Error).message, color: 'rust' });
    }
  };

  const createAndAdd = async () => {
    if (!form.name) return;
    try {
      const newType = await createType.mutateAsync({ shop_id: shopId, ...form });
      await createInstance.mutateAsync({
        shop_id: shopId,
        container_type_id: newType.id,
        location_id: locationId,
      });
      notifications.show({ title: 'Type créé + ajouté ici', message: form.name, color: 'moss' });
      onClose();
    } catch (e) {
      notifications.show({ title: 'Erreur', message: (e as Error).message, color: 'rust' });
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Ajouter un conteneur" centered size="md">
      <Tabs value={tab} onChange={setTab}>
        <Tabs.List>
          <Tabs.Tab value="existing">Choisir un type</Tabs.Tab>
          <Tabs.Tab value="new">Créer un type</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="existing" pt="md">
          <Stack>
            <Select
              label="Type de conteneur"
              data={existingTypes.map((t) => ({ value: t.id, label: `${t.name} (cap. ${t.max_capacity})` }))}
              value={selectedTypeId}
              onChange={setSelectedTypeId}
              placeholder="Sélectionner…"
              searchable
              nothingFoundMessage="Aucun type. Crée-en un dans l'autre onglet."
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>Annuler</Button>
              <Button onClick={addExisting} disabled={!selectedTypeId} loading={createInstance.isPending}>
                Ajouter ici
              </Button>
            </Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="new" pt="md">
          <Stack>
            <TextInput label="Nom" value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} required />
            <NumberInput
              label="Capacité max"
              value={form.max_capacity}
              onChange={(v) => setForm({ ...form, max_capacity: typeof v === 'number' ? v : 1 })}
              min={1}
              required
            />
            <NumberInput
              label="Poids à vide (g)"
              value={form.empty_weight_g ?? ''}
              onChange={(v) => setForm({ ...form, empty_weight_g: typeof v === 'number' ? v : null })}
              min={0}
            />
            <Group grow>
              <NumberInput label="Ratio W" value={form.ratio_w} onChange={(v) => setForm({ ...form, ratio_w: typeof v === 'number' ? v : 1 })} min={1} max={5} />
              <NumberInput label="Ratio H" value={form.ratio_h} onChange={(v) => setForm({ ...form, ratio_h: typeof v === 'number' ? v : 1 })} min={1} max={5} />
            </Group>
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>Annuler</Button>
              <Button onClick={createAndAdd} loading={createType.isPending || createInstance.isPending}>
                Créer + ajouter
              </Button>
            </Group>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}
```

- [ ] **Step 2 : Commit**

```bash
git add src/components/Logistique/AddContainerModal.tsx
git commit -m "feat(logistique): AddContainerModal (choix type ou création rapide)"
```

### Task 5.5 : Modal « Affecter des produits »

**Files:**
- Create: `src/components/Logistique/AssignProductsModal.tsx`

- [ ] **Step 1 : Composant**

```tsx
// src/components/Logistique/AssignProductsModal.tsx
'use client';

import { useEffect, useState } from 'react';
import { Modal, MultiSelect, Stack, Button, Group } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useProducts } from '@/hooks/useProducts';
import { useSetContainerProducts, type ContainerInstance } from '@/hooks/useContainers';

interface Props {
  opened: boolean;
  onClose: () => void;
  instance: ContainerInstance;
  shopId: string;
}

export function AssignProductsModal({ opened, onClose, instance, shopId }: Props) {
  const { data: products = [] } = useProducts(shopId);
  const setProducts = useSetContainerProducts();
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    setSelected(instance.products.map((p) => p.id));
  }, [instance]);

  const submit = async () => {
    try {
      await setProducts.mutateAsync({ id: instance.id, productIds: selected });
      notifications.show({ title: 'Affectation mise à jour', message: '', color: 'moss' });
      onClose();
    } catch (e) {
      notifications.show({ title: 'Erreur', message: (e as Error).message, color: 'rust' });
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={`Affecter — ${instance.type.name}`} centered>
      <Stack>
        <MultiSelect
          label="Produits"
          placeholder="Choisir un ou plusieurs produits"
          data={products.map((p: any) => ({ value: p.id, label: p.title }))}
          value={selected}
          onChange={setSelected}
          searchable
          nothingFoundMessage="Aucun produit"
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Annuler</Button>
          <Button onClick={submit} loading={setProducts.isPending}>Enregistrer</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
```

⚠️ **Note** : `useProducts` est dans `src/hooks/useProducts.ts`. Vérifier sa signature ; le shape `{ id, title }` est attendu. Si le hook nécessite d'autres paramètres ou que le shape diffère, adapter (ex: filtrer par `shopify_active = true` pour ne lister que les produits actifs).

- [ ] **Step 2 : Commit**

```bash
git add src/components/Logistique/AssignProductsModal.tsx
git commit -m "feat(logistique): AssignProductsModal (multi-select produits par caisse)"
```

### Task 5.6 : Smoke test end-to-end

- [ ] **Step 1 : Démarrer le dev server**

```bash
pnpm dev
```

- [ ] **Step 2 : Parcours golden path**

1. `/parametres/conteneurs` → créer « Caisse Tshirt classique » (cap=70, poids=350, 1×1).
2. `/ivy/inventaire/logistique` → sélectionner emplacement « Uriel (Boxer) » (via LocationSelector).
3. Cliquer « Ajouter un conteneur » → onglet « Choisir un type » → sélectionner « Caisse Tshirt classique » → Ajouter.
4. La caisse apparaît, badge ⛈ (vide).
5. Cliquer la caisse → modal Affectation → choisir « Skjaldmö » → Enregistrer.
6. La caisse se remplit visuellement avec des blocs colorés (couleurs des variantes Skjaldmö en stock à Boxer). Vérifier le %.
7. Hover un bloc → tooltip « Skjaldmö / Mocha / M — N unités ».
8. Changer d'emplacement via LocationSelector → la grille se vide ou change.
9. Retour à Boxer → la caisse est toujours là.
10. Menu ⋯ → Retirer la caisse → confirme la suppression.

- [ ] **Step 3 : Edge cases à vérifier manuellement**

- Caisse avec 0 produits affectés → badge ⛈, footer « Aucun produit affecté »
- Plus de stock que la capacité (>100%) → barre saturée à 100%, badge `100%` (ou afficher la valeur réelle si débat — préférer 100% côté visu et pct réel dans le tooltip)
- Type de conteneur supprimé via Paramètres alors qu'instances existent → erreur 409 attendue
- Ratio 2×1 (rectangle large) et 1×2 (rectangle haut) → la caisse a la bonne forme

- [ ] **Step 4 : Commit final**

```bash
git add -A
git commit -m "chore(logistique): smoke test passing — end-to-end fonctionnel" --allow-empty
```

---

## Phase 6 : Finalisation

### Task 6.1 : Bump version + push

**Files:**
- Modify: `src/config/version.ts`

- [ ] **Step 1 : Lire la version actuelle**

```bash
cat src/config/version.ts
```

- [ ] **Step 2 : Bump patch**

Si `APP_VERSION = '1.X.Y'` → passer à `'1.X.(Y+1)'`. Modifier le fichier.

- [ ] **Step 3 : Commit + push**

```bash
git add src/config/version.ts
git commit -m "chore: bump APP_VERSION (caisses logistique)"
git push -u origin feat/caisses-logistique
```

### Task 6.2 : Mettre à jour OpenWolf

**Files:**
- Modify: `.wolf/anatomy.md`
- Modify: `.wolf/cerebrum.md` (Key Learnings)
- Modify: `.wolf/memory.md`

- [ ] **Step 1 : Ajouter les nouveaux fichiers à anatomy.md**

Ajouter sous les sections appropriées :
- `supabase/migrations/041_containers.sql`
- `supabase/migrations/042_variant_weight.sql` (si créée)
- `src/app/api/inventory/container-types/route.ts` + `[id]/route.ts`
- `src/app/api/inventory/containers/route.ts` + `[id]/route.ts` + `[id]/products/route.ts`
- `src/hooks/useContainerTypes.ts`, `src/hooks/useContainers.ts`
- `src/app/parametres/conteneurs/page.tsx` + scss
- `src/app/ivy/inventaire/logistique/page.tsx` + scss
- `src/components/Logistique/ContainerCard.tsx` + scss
- `src/components/Logistique/AddContainerModal.tsx`
- `src/components/Logistique/AssignProductsModal.tsx`

- [ ] **Step 2 : Ajouter une Key Learning à cerebrum.md**

Ex: « Caisses : `container_instances.location_id` est un Shopify location id (text), pas un UUID. Pattern de remplissage : partir de `products` → embed `product_variants → inventory_levels` filtré par locationId. »

- [ ] **Step 3 : Ajouter une ligne à memory.md**

```
| HH:MM | feat caisses logistique | Phase 1-6 | shipped on feat/caisses-logistique | ~6000 |
```

- [ ] **Step 4 : Commit**

```bash
git add .wolf/
git commit -m "chore(openwolf): tracking caisses logistique"
git push
```

### Task 6.3 : PR (optionnel — l'app est auto-deploy sur push main, mais cette branche n'est PAS main)

- [ ] **Step 1 : Créer la PR via gh**

```bash
gh pr create --title "feat(logistique): caisses & visu Tetris" --body "$(cat <<'EOF'
## Summary
- Tables `container_types`, `container_instances`, `container_instance_products`
- Pages : `/parametres/conteneurs` (CRUD types) + `/ivy/inventaire/logistique` (visu Tetris coloré)
- Endpoints REST : `/api/inventory/container-types/*` + `/api/inventory/containers/*`
- Badges météo ☀/☁/⛈ selon % de remplissage

## Test plan
- [x] Smoke test golden path (cf. plan Task 5.6)
- [x] Edge cases (caisse vide, sur-capacité, ratios)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2 : Merge si tout est OK**

Reviewer / merger via interface GitHub. Le déploiement Netlify se fait au merge dans main.

---

## Annexes

### Vérifications préalables (à faire avant Task 2.1)

1. **`product_variants.color`** existe-t-il ? Si non → adapter API logistique pour renvoyer `options` brutes et résoudre côté front (cf. Task 2.3).
2. **`product_variants.weight_g`** existe-t-il ? Cf. Task 1.2.
3. **`useLocation()` hook** : renvoie-t-il `{ currentLocation: { id: string, name: string } }` ? Cf. `src/context/LocationContext.tsx`.
4. **`useProducts(shopId)` hook** : signature et shape ? Cf. `src/hooks/useProducts.ts`.

### Patterns à respecter

- Tous les endpoints filtrent par `shop_id` via RLS (`createServerClient`).
- Toutes les queries `inventory_levels` partent de `products` (cf. cerebrum.md Key Learning).
- Le `location_id` envoyé/reçu est **toujours** une string (Shopify location id).
- Les tokens SCSS Atelier boréal viennent de `@/style/tokens` et les mixins typographiques de `@/style/typography`.
- Pas de tests automatisés (no test framework). Smoke tests manuels uniquement.

### Hors scope V1 (cf. spec)

- Suggestion automatique de quantités à produire
- Mouvements de caisses entre emplacements
- Historique d'affectations
- Multi-affectation (1 variante répartie sur plusieurs caisses)
- Edge case « 1 produit dans 2 caisses au même emplacement » → V1 compte le stock 2x, on documente seulement
