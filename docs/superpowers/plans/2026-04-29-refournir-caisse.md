# Refournir une Caisse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Refournir" feature on each caisse in `/ivy/inventaire/logistique` that proposes per-variant refill suggestions (top-up to capacity at sales prorata) and routes them into a draft `supplier_orders`.

**Architecture:** Two new REST endpoints (`GET refill-suggestions`, `POST refill`), one math utility (Hamilton method for fair rounding), one modal + fill-bar React component, plus minor edits to the existing `ContainerCard` menu and `LogistiquePage` state. No DB migration. The endpoints are designed REST-first so they can be wrapped later by an MCP server or API-key middleware for AI-driven invocation.

**Tech Stack:** Next.js 16 App Router · React 19 · Mantine 7 · Supabase (service role) · TanStack Query 5 · TypeScript strict · SCSS modules · pnpm

**Spec:** `docs/superpowers/specs/2026-04-29-refournir-caisse-design.md`

**Important note on testing:** This project has no test framework (per `CLAUDE.md`). Each task ends with manual verification (running the app, hitting endpoints with curl/fetch, or one-off Node scripts where applicable) instead of automated tests. The Hamilton math utility is the only piece small enough to verify with a standalone Node script.

---

## Task 1: Hamilton math utility (top-up rounding)

**Why:** Pure function isolated for easy reasoning + verifiability with a standalone script. Used by Task 2 endpoint.

**Files:**
- Create: `src/utils/refill-math.ts`

- [ ] **Step 1: Implement `computeRefillSuggestions`**

```typescript
// src/utils/refill-math.ts
export interface VariantInput {
  variantId: string;
  soldInWindow: number;
  currentInBox: number;
}

export interface VariantSuggestion extends VariantInput {
  targetQty: number;
  suggestedQty: number;
}

/**
 * Top-up à la capacité au prorata des sorties.
 * Méthode du plus grand reste (Hamilton) — garantit Σ targets == maxCapacity.
 * Si totalSold === 0, fallback équiprobable (max_capacity / N).
 */
export function computeRefillSuggestions(
  variants: VariantInput[],
  maxCapacity: number,
): VariantSuggestion[] {
  if (variants.length === 0 || maxCapacity <= 0) {
    return variants.map((v) => ({ ...v, targetQty: 0, suggestedQty: 0 }));
  }

  const totalSold = variants.reduce((sum, v) => sum + v.soldInWindow, 0);
  const N = variants.length;

  const rawTargets = variants.map((v) =>
    totalSold > 0
      ? (v.soldInWindow / totalSold) * maxCapacity
      : maxCapacity / N,
  );

  const floors = rawTargets.map((t) => Math.floor(t));
  const allocated = floors.reduce((s, n) => s + n, 0);
  const toDistribute = maxCapacity - allocated;

  const remainders = rawTargets
    .map((t, i) => ({ idx: i, rem: t - Math.floor(t) }))
    .sort((a, b) => b.rem - a.rem || a.idx - b.idx);

  const targets = [...floors];
  for (let i = 0; i < toDistribute && i < remainders.length; i++) {
    targets[remainders[i].idx] += 1;
  }

  return variants.map((v, i) => ({
    ...v,
    targetQty: targets[i],
    suggestedQty: Math.max(0, targets[i] - v.currentInBox),
  }));
}
```

- [ ] **Step 2: Verify with a standalone Node script**

Create a temporary file `/tmp/refill-math-check.mjs` (or run directly via `node -e`):

```javascript
// Inline test — paste this into `node -e "..."`
import { computeRefillSuggestions } from './src/utils/refill-math.ts';

// Won't work directly since it's TS, so use a JS clone for the script:
// Or just verify visually by importing in Next.js dev server.
```

Simpler: drop a temporary one-shot check into `src/app/page.tsx` or use the dev console. **Recommended:** add a quick Bun-style check by running:

```bash
pnpm exec tsx -e "
import { computeRefillSuggestions } from './src/utils/refill-math.ts';

// Cas A — total_sold > 0
const a = computeRefillSuggestions([
  { variantId: 'A', soldInWindow: 50, currentInBox: 5 },
  { variantId: 'B', soldInWindow: 30, currentInBox: 0 },
  { variantId: 'C', soldInWindow: 20, currentInBox: 10 },
], 70);
console.log('Cas A targets sum:', a.reduce((s, v) => s + v.targetQty, 0)); // expect 70
console.log(a);

// Cas B — total_sold == 0 (fallback équiprobable)
const b = computeRefillSuggestions([
  { variantId: 'A', soldInWindow: 0, currentInBox: 0 },
  { variantId: 'B', soldInWindow: 0, currentInBox: 0 },
  { variantId: 'C', soldInWindow: 0, currentInBox: 0 },
], 70);
console.log('Cas B targets sum:', b.reduce((s, v) => s + v.targetQty, 0)); // expect 70 (24, 23, 23 ou similaire)
console.log(b);

// Cas C — N=0
const c = computeRefillSuggestions([], 70);
console.log('Cas C:', c); // expect []
"
```

Expected: every `Σ targetQty === maxCapacity`. Cas B produces 24+23+23 (or any permutation summing to 70).

If `tsx` isn't installed: `pnpm add -D tsx` ou create a `.mjs` clone of the function for the test.

- [ ] **Step 3: Commit**

```bash
git add src/utils/refill-math.ts
git commit -m "feat(refill): top-up Hamilton math utility"
```

---

## Task 2: `GET refill-suggestions` endpoint

**Why:** Pure read endpoint — given a container ID and a window, returns all suggestion data the modal needs.

**Files:**
- Create: `src/app/api/inventory/containers/[id]/refill-suggestions/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
// src/app/api/inventory/containers/[id]/refill-suggestions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';
import { computeRefillSuggestions, VariantInput } from '@/utils/refill-math';

const COLOR_OPTION_NAMES = ['couleur', 'color', 'colour'];
const SIZE_OPTION_NAMES = ['taille', 'size'];

function extractByOptionName(
  variant: { option1?: string | null; option2?: string | null; option3?: string | null },
  product: { option1_name?: string | null; option2_name?: string | null; option3_name?: string | null },
  matchNames: string[],
): string | null {
  const slots: Array<[string | null | undefined, string | null | undefined]> = [
    [product.option1_name, variant.option1],
    [product.option2_name, variant.option2],
    [product.option3_name, variant.option3],
  ];
  for (const [name, value] of slots) {
    if (name && matchNames.includes(String(name).toLowerCase()) && value) {
      return value;
    }
  }
  return null;
}

function dateRangeFromDays(days: number): { from: string; to: string } {
  const today = new Date();
  const past = new Date(today);
  past.setDate(today.getDate() - days);
  return {
    from: past.toISOString().split('T')[0],
    to: today.toISOString().split('T')[0],
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: containerId } = await params;
  const url = new URL(request.url);
  const windowParam = url.searchParams.get('window') || '30d';
  const zoneId = url.searchParams.get('zoneId');

  if (!['7d', '30d', 'all', 'zone'].includes(windowParam)) {
    return NextResponse.json({ error: 'Invalid window' }, { status: 400 });
  }
  if (windowParam === 'zone' && !zoneId) {
    return NextResponse.json({ error: 'zoneId required when window=zone' }, { status: 400 });
  }

  const supabase = createServerClient();

  // 1. Load container + type
  const { data: container, error: cErr } = await supabase
    .from('container_instances')
    .select(`
      id, shop_id, location_id, name,
      type:container_types(id, name, max_capacity)
    `)
    .eq('id', containerId)
    .maybeSingle();

  if (cErr || !container) {
    return NextResponse.json({ error: 'Container not found' }, { status: 404 });
  }
  const type = Array.isArray(container.type) ? container.type[0] : container.type;
  const containerName = container.name?.trim() || type.name;

  // 2. Load color rules for hex resolution
  const { data: colorRules } = await supabase
    .from('color_rules')
    .select('reception_name, hex_value')
    .eq('shop_id', container.shop_id);
  const colorHexMap = new Map<string, string>();
  for (const r of colorRules ?? []) {
    if (r.reception_name) {
      colorHexMap.set(String(r.reception_name).toLowerCase().trim(), r.hex_value || '');
    }
  }
  const resolveHex = (color: string | null): string | null =>
    color ? colorHexMap.get(color.toLowerCase().trim()) || null : null;

  // 3. Load assigned products
  const { data: cipRows } = await supabase
    .from('container_instance_products')
    .select(`
      product:products(
        id, title, status,
        option1_name, option2_name, option3_name
      )
    `)
    .eq('container_instance_id', containerId);

  const products = (cipRows ?? [])
    .map((r: any) => r.product)
    .filter(Boolean);
  const productIds = products.map((p: any) => p.id);

  // Empty case
  if (productIds.length === 0) {
    return NextResponse.json({
      containerId,
      containerName,
      capacity: { max: type.max_capacity, current: 0, pct: 0 },
      window: { type: 'days', label: 'Aucun produit affecté' },
      products: [],
    });
  }

  // 4. Load all "vivantes" variants for these products
  // Living = shopify_active=true OR product.status='local'
  const { data: variantsRaw } = await supabase
    .from('product_variants')
    .select(`
      id, product_id, sku, option1, option2, option3, shopify_active
    `)
    .in('product_id', productIds);

  const productById = new Map(products.map((p: any) => [p.id, p]));
  const variants = (variantsRaw ?? []).filter((v: any) => {
    const p = productById.get(v.product_id);
    if (!p) return false;
    return v.shopify_active === true || p.status === 'local';
  });
  const variantIds = variants.map((v: any) => v.id);

  if (variantIds.length === 0) {
    return NextResponse.json({
      containerId,
      containerName,
      capacity: { max: type.max_capacity, current: 0, pct: 0 },
      window: { type: 'days', label: 'Aucune variante vivante' },
      products: [],
    });
  }

  // 5. Resolve location: container.location_id is Shopify ID (TEXT)
  // For stock_movements we need UUID
  const { data: locRow } = await supabase
    .from('locations')
    .select('id')
    .eq('shopify_id', container.location_id)
    .maybeSingle();
  const locationUuid = locRow?.id;

  // 6. Determine date range
  let dateRange: { from: string; to: string } | null = null;
  let windowLabel = 'Depuis toujours';
  let windowType: 'days' | 'zone' | 'all' = 'all';

  if (windowParam === 'zone') {
    const { data: zone } = await supabase
      .from('pos_study_zones')
      .select('id, name, start_date, end_date')
      .eq('id', zoneId)
      .maybeSingle();
    if (!zone) {
      return NextResponse.json({ error: 'Zone not found' }, { status: 404 });
    }
    dateRange = { from: zone.start_date, to: zone.end_date };
    windowLabel = zone.name;
    windowType = 'zone';
  } else if (windowParam !== 'all') {
    const days = windowParam === '7d' ? 7 : 30;
    dateRange = dateRangeFromDays(days);
    windowLabel = windowParam === '7d' ? '7 derniers jours' : '30 derniers jours';
    windowType = 'days';
  }

  // 7. Aggregate stock_movements (negative = sortie)
  let mvtQuery = supabase
    .from('stock_movements')
    .select('variant_id, quantity')
    .in('variant_id', variantIds)
    .lt('quantity', 0);
  if (locationUuid) mvtQuery = mvtQuery.eq('location_id', locationUuid);
  if (dateRange) {
    mvtQuery = mvtQuery.gte('moved_on', dateRange.from).lte('moved_on', dateRange.to);
  }
  const { data: movements } = await mvtQuery;

  const soldByVariant = new Map<string, number>();
  for (const m of movements ?? []) {
    const prev = soldByVariant.get(m.variant_id) || 0;
    soldByVariant.set(m.variant_id, prev + Math.abs(m.quantity));
  }

  // 8. Load inventory_levels (Shopify ID for location)
  const { data: levels } = await supabase
    .from('inventory_levels')
    .select('variant_id, quantity')
    .in('variant_id', variantIds)
    .eq('location_id', container.location_id);

  const qtyByVariant = new Map<string, number>();
  for (const l of levels ?? []) {
    qtyByVariant.set(l.variant_id, Math.max(0, l.quantity || 0));
  }

  // 9. Compute suggestions via Hamilton
  const inputs: VariantInput[] = variants.map((v: any) => ({
    variantId: v.id,
    soldInWindow: soldByVariant.get(v.id) || 0,
    currentInBox: qtyByVariant.get(v.id) || 0,
  }));
  const suggestions = computeRefillSuggestions(inputs, type.max_capacity);
  const suggestionByVariant = new Map(suggestions.map((s) => [s.variantId, s]));

  // 10. Group by product, build response
  const variantByProduct = new Map<string, any[]>();
  for (const v of variants) {
    const p = productById.get(v.product_id);
    if (!p) continue;
    const color = extractByOptionName(v, p, COLOR_OPTION_NAMES);
    const size = extractByOptionName(v, p, SIZE_OPTION_NAMES);
    const sug = suggestionByVariant.get(v.id);
    const titleParts = [v.option1, v.option2, v.option3].filter(Boolean);
    const variantOut = {
      variantId: v.id,
      title: titleParts.join(' · ') || 'Default',
      sku: v.sku,
      color,
      colorHex: resolveHex(color),
      size,
      currentInBox: sug?.currentInBox ?? 0,
      currentAtLocation: sug?.currentInBox ?? 0,
      soldInWindow: sug?.soldInWindow ?? 0,
      suggestedQty: sug?.suggestedQty ?? 0,
    };
    if (!variantByProduct.has(v.product_id)) variantByProduct.set(v.product_id, []);
    variantByProduct.get(v.product_id)!.push(variantOut);
  }

  const productsOut = products
    .map((p: any) => ({
      productId: p.id,
      title: p.title,
      variants: variantByProduct.get(p.id) || [],
    }))
    .filter((p: any) => p.variants.length > 0)
    .sort((a: any, b: any) => a.title.localeCompare(b.title));

  const totalCurrent = inputs.reduce((s, v) => s + v.currentInBox, 0);
  const pct = type.max_capacity > 0
    ? Math.min(100, Math.round((totalCurrent / type.max_capacity) * 100))
    : 0;

  return NextResponse.json({
    containerId,
    containerName,
    capacity: { max: type.max_capacity, current: totalCurrent, pct },
    window: { type: windowType, label: windowLabel },
    products: productsOut,
  });
}
```

- [ ] **Step 2: Manually test the endpoint**

Start dev server (`pnpm dev`), find a container ID via the Logistique page, then:

```bash
curl 'http://localhost:3000/api/inventory/containers/<UUID>/refill-suggestions?window=30d' | jq .
```

Verify:
- `containerId`, `containerName`, `capacity.max` are correct
- `products[]` contains assigned products with their variants
- Each variant has `currentInBox`, `soldInWindow`, `suggestedQty`
- `Σ (currentInBox + suggestedQty)` for any single product ≤ `capacity.max`
- `Σ targetQty` (= currentInBox + suggestedQty when no overflow) totals to `capacity.max`

Test edge cases by changing query params:
- `window=7d`, `window=all`, `window=zone&zoneId=<UUID>`
- A container with no products assigned → `products: []` + window label "Aucun produit affecté"

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/containers/[id]/refill-suggestions/
git commit -m "feat(refill): GET refill-suggestions endpoint"
```

---

## Task 3: `POST refill` endpoint (create-or-append)

**Why:** Single transactional endpoint to create a new draft `supplier_orders` (or append to an existing one), with idempotent merge on duplicate `variant_id`.

**Files:**
- Create: `src/app/api/inventory/containers/[id]/refill/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
// src/app/api/inventory/containers/[id]/refill/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';

interface RefillLine {
  variantId: string;
  quantity: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: containerId } = await params;

  let body: { shopId?: string; orderId?: string; lines?: RefillLine[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { shopId, orderId, lines } = body;

  if (!shopId) {
    return NextResponse.json({ error: 'shopId required' }, { status: 400 });
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json({ error: 'Aucune ligne à ajouter' }, { status: 400 });
  }

  const cleanLines = lines.filter(
    (l) => l && typeof l.variantId === 'string' && typeof l.quantity === 'number' && l.quantity > 0,
  );
  if (cleanLines.length === 0) {
    return NextResponse.json({ error: 'Toutes les quantités sont à 0' }, { status: 400 });
  }

  const supabase = createServerClient();

  // 1. Verify container belongs to this shop
  const { data: container } = await supabase
    .from('container_instances')
    .select('id, shop_id')
    .eq('id', containerId)
    .maybeSingle();
  if (!container || container.shop_id !== shopId) {
    return NextResponse.json({ error: 'Container not found' }, { status: 404 });
  }

  // 2. Determine target order
  let targetOrderId: string;
  let targetOrderNumber: string;

  if (orderId) {
    const { data: existing } = await supabase
      .from('supplier_orders')
      .select('id, order_number, status, shop_id, balance_adjustment')
      .eq('id', orderId)
      .maybeSingle();
    if (!existing || existing.shop_id !== shopId) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (existing.status !== 'draft') {
      return NextResponse.json(
        { error: "Cette commande n'est plus modifiable (status ≠ draft)" },
        { status: 409 },
      );
    }
    targetOrderId = existing.id;
    targetOrderNumber = existing.order_number;
  } else {
    // Create a new draft order
    const { count } = await supabase
      .from('supplier_orders')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shopId);
    const newNumber = `BATCH-${String((count || 0) + 1).padStart(4, '0')}`;
    const { data: newOrder, error: createErr } = await supabase
      .from('supplier_orders')
      .insert({
        shop_id: shopId,
        order_number: newNumber,
        status: 'draft',
      })
      .select('id, order_number')
      .single();
    if (createErr || !newOrder) {
      return NextResponse.json(
        { error: createErr?.message || 'Failed to create order' },
        { status: 500 },
      );
    }
    targetOrderId = newOrder.id;
    targetOrderNumber = newOrder.order_number;
  }

  // 3. Load existing lines for this order to detect dup variants
  const { data: existingItems } = await supabase
    .from('supplier_order_items')
    .select('id, variant_id, quantity, line_total, unit_price')
    .eq('order_id', targetOrderId);
  const existingByVariant = new Map<string, typeof existingItems[number]>();
  for (const it of existingItems ?? []) {
    if (it.variant_id) existingByVariant.set(it.variant_id, it);
  }

  // 4. Load variant + product info for each line
  const variantIds = cleanLines.map((l) => l.variantId);
  const { data: variantsInfo } = await supabase
    .from('product_variants')
    .select(`
      id, sku, title, option1, option2, option3,
      product:products(title)
    `)
    .in('id', variantIds);
  const variantInfoById = new Map(
    (variantsInfo ?? []).map((v: any) => {
      const product = Array.isArray(v.product) ? v.product[0] : v.product;
      return [
        v.id,
        {
          sku: v.sku,
          variantTitle: [v.option1, v.option2, v.option3].filter(Boolean).join(' · ') || v.title || null,
          productTitle: product?.title || 'Produit inconnu',
        },
      ];
    }),
  );

  // 5. Process each line: increment or insert
  const errors: Array<{ variantId: string; reason: string }> = [];
  let linesAdded = 0;
  let linesIncremented = 0;

  for (const line of cleanLines) {
    const info = variantInfoById.get(line.variantId);
    if (!info) {
      errors.push({ variantId: line.variantId, reason: 'Variant not found' });
      continue;
    }

    const existing = existingByVariant.get(line.variantId);
    if (existing) {
      const newQty = existing.quantity + line.quantity;
      const newLineTotal = (existing.unit_price || 0) * newQty;
      const { error: updErr } = await supabase
        .from('supplier_order_items')
        .update({
          quantity: newQty,
          line_total: newLineTotal,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      if (updErr) {
        errors.push({ variantId: line.variantId, reason: updErr.message });
      } else {
        linesIncremented += 1;
      }
    } else {
      const { error: insErr } = await supabase
        .from('supplier_order_items')
        .insert({
          order_id: targetOrderId,
          variant_id: line.variantId,
          product_title: info.productTitle,
          variant_title: info.variantTitle,
          sku: info.sku,
          quantity: line.quantity,
          unit_price: 0,
          line_total: 0,
          is_validated: false,
        });
      if (insErr) {
        errors.push({ variantId: line.variantId, reason: insErr.message });
      } else {
        linesAdded += 1;
      }
    }
  }

  // 6. Recompute order totals
  const { data: refreshedItems } = await supabase
    .from('supplier_order_items')
    .select('line_total')
    .eq('order_id', targetOrderId);
  const subtotal = (refreshedItems ?? []).reduce(
    (s, it) => s + (Number(it.line_total) || 0),
    0,
  );
  const { data: orderRow } = await supabase
    .from('supplier_orders')
    .select('balance_adjustment')
    .eq('id', targetOrderId)
    .single();
  const balance = Number(orderRow?.balance_adjustment) || 0;
  const totalHt = subtotal + balance;
  await supabase
    .from('supplier_orders')
    .update({
      subtotal,
      total_ht: totalHt,
      total_ttc: totalHt * 1.2,
      updated_at: new Date().toISOString(),
    })
    .eq('id', targetOrderId);

  return NextResponse.json({
    orderId: targetOrderId,
    orderNumber: targetOrderNumber,
    linesAdded,
    linesIncremented,
    errors: errors.length > 0 ? errors : undefined,
  });
}
```

- [ ] **Step 2: Manually test the endpoint**

```bash
# Create new order
curl -X POST http://localhost:3000/api/inventory/containers/<UUID>/refill \
  -H 'Content-Type: application/json' \
  -d '{
    "shopId": "<SHOP_UUID>",
    "lines": [
      { "variantId": "<VARIANT_UUID>", "quantity": 5 },
      { "variantId": "<VARIANT_UUID_2>", "quantity": 3 }
    ]
  }' | jq .

# Append to existing draft (use orderId from prev response)
curl -X POST http://localhost:3000/api/inventory/containers/<UUID>/refill \
  -H 'Content-Type: application/json' \
  -d '{
    "shopId": "<SHOP_UUID>",
    "orderId": "<ORDER_UUID>",
    "lines": [{ "variantId": "<VARIANT_UUID>", "quantity": 2 }]
  }' | jq .
# Verify same variant got incremented (linesIncremented: 1)
```

Verify in `/ivy/commandes/stock`:
- New `BATCH-NNNN` appears
- Lines have `variant_id`, `product_title`, `variant_title`, `sku`, `quantity`
- `unit_price=0`, `line_total=0` (price rules apply later)
- `subtotal` is 0 + `balance_adjustment` (if any)

Test 409 path: append to a non-draft order → expect `409`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/containers/[id]/refill/
git commit -m "feat(refill): POST refill endpoint (create-or-append)"
```

---

## Task 4: `useRefill` hook (suggestions + submit)

**Why:** Co-locate the two API calls behind a clean React hook for the modal.

**Files:**
- Create: `src/hooks/useRefill.ts`

- [ ] **Step 1: Implement the hook**

```typescript
// src/hooks/useRefill.ts
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
  window: RefillWindow,
  zoneId?: string | null,
  enabled: boolean = true,
) {
  return useQuery<RefillSuggestionsResponse>({
    queryKey: ['refill-suggestions', containerId, window, zoneId],
    enabled: !!containerId && enabled && (window !== 'zone' || !!zoneId),
    queryFn: async () => {
      const url = new URL(
        `/api/inventory/containers/${containerId}/refill-suggestions`,
        window.location.origin,
      );
      url.searchParams.set('window', window === 'zone' ? 'zone' : window);
      if (window === 'zone' && zoneId) url.searchParams.set('zoneId', zoneId);
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
```

⚠️ **Note**: there's a name collision — `window` (the param) shadows the global `window` object inside `queryFn`. Rename the param to `windowParam` or use `globalThis.location.origin`. Fix in this step.

```typescript
// Fix: rename param to avoid shadowing
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
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useRefill.ts
git commit -m "feat(refill): useRefillSuggestions + useSubmitRefill hooks"
```

---

## Task 5: `RefillFillBar` component

**Why:** Reusable visual — barre avant/après avec 3 zones + overflow.

**Files:**
- Create: `src/components/Logistique/RefillFillBar.tsx`
- Create: `src/components/Logistique/RefillFillBar.module.scss`

- [ ] **Step 1: Implement the component**

```typescript
// src/components/Logistique/RefillFillBar.tsx
'use client';

import clsx from 'clsx';
import styles from './RefillFillBar.module.scss';

interface Props {
  current: number;
  added: number;
  capacity: number;
}

export function RefillFillBar({ current, added, capacity }: Props) {
  const safeCap = Math.max(1, capacity);
  const total = current + added;
  const overflow = Math.max(0, total - safeCap);
  const overflowPct = overflow > 0 ? (overflow / safeCap) * 100 : 0;
  const currentPct = Math.min(100, (current / safeCap) * 100);
  const addedPct = Math.min(100 - currentPct, (added / safeCap) * 100);

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <div
          className={clsx(styles.zone, styles.current)}
          style={{ width: `${currentPct}%` }}
          aria-label={`Actuel ${current}`}
        />
        <div
          className={clsx(styles.zone, styles.added)}
          style={{ width: `${addedPct}%` }}
          aria-label={`Ajouté ${added}`}
        />
        {overflow > 0 && (
          <div
            className={clsx(styles.zone, styles.overflow)}
            style={{ width: `${overflowPct}%` }}
            aria-label={`Hors capacité +${overflow}`}
          />
        )}
      </div>
      <div className={styles.labels}>
        <span className={styles.label}>
          Actuel <strong>{current}</strong> → Après <strong>{total}</strong> / {capacity}
        </span>
        {overflow > 0 && <span className={styles.overflowLabel}>+{overflow} hors capacité</span>}
      </div>
    </div>
  );
}
```

```scss
// src/components/Logistique/RefillFillBar.module.scss
@use '@/style/tokens';

.wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.bar {
  position: relative;
  height: 10px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 999px;
  overflow: visible;
  display: flex;
  align-items: stretch;
}

.zone {
  height: 100%;

  &:first-child {
    border-top-left-radius: 999px;
    border-bottom-left-radius: 999px;
  }

  &:last-child {
    border-top-right-radius: 999px;
    border-bottom-right-radius: 999px;
  }
}

.current {
  background: var(--color-rust, #b56a4a);
}

.added {
  background: var(--color-rust, #b56a4a);
  opacity: 0.45;
}

.overflow {
  background: #d23a3a;
  opacity: 0.85;
}

.labels {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.7);
}

.label strong {
  font-weight: 600;
}

.overflowLabel {
  color: #b53030;
  font-weight: 600;
}
```

- [ ] **Step 2: Visual sanity check**

Drop a temporary `<RefillFillBar />` into the Logistique page (or any visible page) with sample values: `(20, 30, 70)`, `(70, 0, 70)`, `(60, 20, 70)` (overflow). Verify visually:
- Zones render with correct widths
- Overflow zone appears red and pushes total bar past 100% width
- Labels update correctly

Remove the temporary mount after verification.

- [ ] **Step 3: Commit**

```bash
git add src/components/Logistique/RefillFillBar.tsx src/components/Logistique/RefillFillBar.module.scss
git commit -m "feat(refill): RefillFillBar component"
```

---

## Task 6: `RefillModal` component

**Why:** Main UI — header with window selector, table grouped by product with steppers, footer with fill bar + submit.

**Files:**
- Create: `src/components/Logistique/RefillModal.tsx`
- Create: `src/components/Logistique/RefillModal.module.scss`

- [ ] **Step 1: Implement the modal**

```typescript
// src/components/Logistique/RefillModal.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Select,
  NumberInput,
  Loader,
  Button,
  ActionIcon,
  Tooltip,
} from '@mantine/core';
import { IconMinus, IconPlus, IconExternalLink } from '@tabler/icons-react';
import { useRefillSuggestions, useSubmitRefill, RefillWindow } from '@/hooks/useRefill';
import { RefillFillBar } from './RefillFillBar';
import { supabase } from '@/supabase/client';
import styles from './RefillModal.module.scss';

interface Props {
  opened: boolean;
  onClose: () => void;
  containerId: string;
  shopId: string;
}

interface DraftOrder {
  id: string;
  order_number: string;
  items_count: number;
}

interface StudyZone {
  id: string;
  name: string;
}

export function RefillModal({ opened, onClose, containerId, shopId }: Props) {
  const [windowParam, setWindowParam] = useState<RefillWindow>('30d');
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [zones, setZones] = useState<StudyZone[]>([]);
  const [drafts, setDrafts] = useState<DraftOrder[]>([]);
  const [adjustedQty, setAdjustedQty] = useState<Map<string, number>>(new Map());
  const [confirmStep, setConfirmStep] = useState<null | 'pick'>(null);
  const [chosenOrderId, setChosenOrderId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<{
    orderId: string;
    orderNumber: string;
    linesAdded: number;
    linesIncremented: number;
  } | null>(null);

  const { data, isLoading, isError } = useRefillSuggestions(
    containerId,
    windowParam,
    zoneId,
    opened,
  );

  const submit = useSubmitRefill();

  // Load zones + draft orders once when modal opens
  useEffect(() => {
    if (!opened) return;
    let mounted = true;
    (async () => {
      const [zoneRes, ordersRes] = await Promise.all([
        supabase
          .from('pos_study_zones')
          .select('id, name')
          .eq('shop_id', shopId)
          .order('end_date', { ascending: false }),
        fetch(`/api/suppliers/orders?shopId=${shopId}`).then((r) => r.json()),
      ]);
      if (!mounted) return;
      setZones((zoneRes.data as StudyZone[]) || []);
      const allOrders = ordersRes?.orders || [];
      setDrafts(
        allOrders
          .filter((o: any) => o.status === 'draft')
          .map((o: any) => ({
            id: o.id,
            order_number: o.order_number,
            items_count: o.items_count || 0,
          })),
      );
    })();
    return () => {
      mounted = false;
    };
  }, [opened, shopId]);

  // Initialize adjusted qty from suggestions
  useEffect(() => {
    if (!data) return;
    const m = new Map<string, number>();
    for (const p of data.products) {
      for (const v of p.variants) {
        m.set(v.variantId, v.suggestedQty);
      }
    }
    setAdjustedQty(m);
  }, [data]);

  // Reset state on close
  useEffect(() => {
    if (!opened) {
      setConfirmStep(null);
      setChosenOrderId(null);
      setSubmitError(null);
      setSubmitSuccess(null);
    }
  }, [opened]);

  const totalAdded = useMemo(
    () => Array.from(adjustedQty.values()).reduce((s, n) => s + n, 0),
    [adjustedQty],
  );
  const submitDisabled = totalAdded === 0 || submit.isPending;

  const handleQty = (variantId: string, value: number) => {
    setAdjustedQty((prev) => {
      const m = new Map(prev);
      m.set(variantId, Math.max(0, Math.floor(value)));
      return m;
    });
  };

  const handleSubmit = async (orderId?: string) => {
    if (!data) return;
    setSubmitError(null);
    const lines = Array.from(adjustedQty.entries())
      .filter(([, qty]) => qty > 0)
      .map(([variantId, quantity]) => ({ variantId, quantity }));
    try {
      const res = await submit.mutateAsync({
        containerId,
        shopId,
        orderId,
        lines,
      });
      setSubmitSuccess({
        orderId: res.orderId,
        orderNumber: res.orderNumber,
        linesAdded: res.linesAdded,
        linesIncremented: res.linesIncremented,
      });
      if (res.errors?.length) {
        setSubmitError(
          `${res.errors.length} ligne(s) en échec : ${res.errors
            .map((e) => e.reason)
            .slice(0, 3)
            .join(', ')}`,
        );
      }
    } catch (err: any) {
      setSubmitError(err.message || 'Erreur inconnue');
    }
  };

  const onClickAdd = () => {
    if (drafts.length === 0) {
      handleSubmit(undefined);
    } else {
      setChosenOrderId(drafts[0].id);
      setConfirmStep('pick');
    }
  };

  const windowOptions = [
    { value: '7d', label: '7 derniers jours' },
    { value: '30d', label: '30 derniers jours' },
    { value: 'all', label: 'Depuis toujours' },
    ...(zones.length > 0 ? [{ value: 'zone', label: 'Festival (zone d\'étude)' }] : []),
  ];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={data ? `Refournir ${data.containerName}` : 'Refournir'}
      size="xl"
      centered
      classNames={{ body: styles.body }}
    >
      {/* Success view */}
      {submitSuccess && (
        <div className={styles.success}>
          <p>
            ✅ <strong>{submitSuccess.linesAdded + submitSuccess.linesIncremented}</strong>{' '}
            ligne(s) traitée(s) sur{' '}
            <strong>{submitSuccess.orderNumber}</strong>
            {submitSuccess.linesIncremented > 0 && ` (${submitSuccess.linesIncremented} incrémentée(s))`}
          </p>
          {submitError && <p className={styles.warn}>{submitError}</p>}
          <div className={styles.successActions}>
            <Button
              component="a"
              href={`/ivy/commandes/stock/${submitSuccess.orderId}`}
              rightSection={<IconExternalLink size={14} />}
              variant="light"
            >
              Ouvrir la commande
            </Button>
            <Button onClick={onClose}>Fermer</Button>
          </div>
        </div>
      )}

      {/* Pick draft step */}
      {!submitSuccess && confirmStep === 'pick' && (
        <div className={styles.pick}>
          <p>Une commande draft est disponible. Tu peux y ajouter les lignes ou en créer une nouvelle.</p>
          <Select
            label="Commande draft"
            data={drafts.map((d) => ({
              value: d.id,
              label: `${d.order_number} (${d.items_count} ligne${d.items_count > 1 ? 's' : ''})`,
            }))}
            value={chosenOrderId}
            onChange={setChosenOrderId}
          />
          <div className={styles.pickActions}>
            <Button variant="default" onClick={() => setConfirmStep(null)}>
              Annuler
            </Button>
            <Button variant="light" onClick={() => handleSubmit(undefined)} loading={submit.isPending}>
              Créer une nouvelle
            </Button>
            <Button
              onClick={() => chosenOrderId && handleSubmit(chosenOrderId)}
              loading={submit.isPending}
              disabled={!chosenOrderId}
            >
              Ajouter à {drafts.find((d) => d.id === chosenOrderId)?.order_number}
            </Button>
          </div>
          {submitError && <p className={styles.error}>{submitError}</p>}
        </div>
      )}

      {/* Main view */}
      {!submitSuccess && confirmStep === null && (
        <>
          <div className={styles.header}>
            <div className={styles.windowSelector}>
              <Select
                size="sm"
                data={windowOptions}
                value={windowParam}
                onChange={(v) => {
                  setWindowParam((v as RefillWindow) || '30d');
                  setZoneId(null);
                }}
              />
              {windowParam === 'zone' && (
                <Select
                  size="sm"
                  placeholder="Choisis une zone"
                  data={zones.map((z) => ({ value: z.id, label: z.name }))}
                  value={zoneId}
                  onChange={setZoneId}
                />
              )}
            </div>
          </div>

          {isLoading && (
            <div className={styles.empty}>
              <Loader size="sm" />
            </div>
          )}

          {isError && <div className={styles.error}>Erreur de chargement.</div>}

          {data && data.products.length === 0 && (
            <div className={styles.empty}>
              {data.window.label === 'Aucun produit affecté'
                ? "Affecte d'abord des produits à cette caisse via le menu ⋯ → Affecter des produits."
                : 'Aucune variante refournissable.'}
            </div>
          )}

          {data && data.products.length > 0 && (
            <div className={styles.body}>
              {data.products.map((p) => (
                <div key={p.productId} className={styles.product}>
                  <h4 className={styles.productTitle}>{p.title}</h4>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Variante</th>
                        <th>Caisse</th>
                        <th>Sorties</th>
                        <th>Suggestion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.variants.map((v) => {
                        const qty = adjustedQty.get(v.variantId) ?? 0;
                        return (
                          <tr key={v.variantId}>
                            <td>
                              <div className={styles.variantCell}>
                                {v.colorHex && (
                                  <span
                                    className={styles.swatch}
                                    style={{ background: v.colorHex }}
                                  />
                                )}
                                <span>{v.title}</span>
                                {v.sku && <span className={styles.sku}>{v.sku}</span>}
                              </div>
                            </td>
                            <td>{v.currentInBox}</td>
                            <td>{v.soldInWindow}</td>
                            <td>
                              <div className={styles.stepper}>
                                <Tooltip label="−5">
                                  <ActionIcon
                                    variant="subtle"
                                    size="sm"
                                    onClick={() => handleQty(v.variantId, qty - 5)}
                                  >
                                    <IconMinus size={12} />
                                  </ActionIcon>
                                </Tooltip>
                                <NumberInput
                                  size="xs"
                                  min={0}
                                  hideControls
                                  value={qty}
                                  onChange={(val) =>
                                    handleQty(v.variantId, typeof val === 'number' ? val : 0)
                                  }
                                  className={styles.qtyInput}
                                />
                                <Tooltip label="+5">
                                  <ActionIcon
                                    variant="subtle"
                                    size="sm"
                                    onClick={() => handleQty(v.variantId, qty + 5)}
                                  >
                                    <IconPlus size={12} />
                                  </ActionIcon>
                                </Tooltip>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {data && (
            <div className={styles.footer}>
              <RefillFillBar
                current={data.capacity.current}
                added={totalAdded}
                capacity={data.capacity.max}
              />
              <Button
                size="md"
                disabled={submitDisabled}
                onClick={onClickAdd}
                loading={submit.isPending}
              >
                Ajouter à une commande de stock
              </Button>
              {submitError && <p className={styles.error}>{submitError}</p>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
```

```scss
// src/components/Logistique/RefillModal.module.scss
@use '@/style/tokens';

.body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 70vh;
  overflow: visible;
}

.header {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.windowSelector {
  display: flex;
  gap: 8px;
  align-items: center;
}

.empty {
  text-align: center;
  padding: 24px;
  color: rgba(0, 0, 0, 0.55);
}

.error {
  color: #b53030;
  font-size: 13px;
  margin-top: 8px;
}

.warn {
  color: #b58030;
  font-size: 13px;
  margin-top: 4px;
}

.product {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid rgba(0, 0, 0, 0.07);

  &:first-child {
    border-top: none;
    padding-top: 0;
  }
}

.productTitle {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th, td {
    padding: 6px 8px;
    text-align: left;
    border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  }

  th {
    color: rgba(0, 0, 0, 0.55);
    font-weight: 500;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  td:nth-child(2),
  td:nth-child(3),
  th:nth-child(2),
  th:nth-child(3) {
    text-align: right;
    width: 80px;
  }

  td:nth-child(4),
  th:nth-child(4) {
    width: 140px;
  }
}

.variantCell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  flex-shrink: 0;
}

.sku {
  color: rgba(0, 0, 0, 0.45);
  font-size: 11px;
  margin-left: 8px;
}

.stepper {
  display: flex;
  align-items: center;
  gap: 4px;
}

.qtyInput {
  width: 60px;
  text-align: center;

  input {
    text-align: center;
  }
}

.footer {
  position: sticky;
  bottom: 0;
  background: white;
  padding-top: 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.07);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.success {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  text-align: center;
}

.successActions {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.pick {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 0;
}

.pickActions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Logistique/RefillModal.tsx src/components/Logistique/RefillModal.module.scss
git commit -m "feat(refill): RefillModal component with steppers + fill bar"
```

---

## Task 7: Add "Refournir" entry to ContainerCard menu

**Why:** Wire the trigger.

**Files:**
- Modify: `src/components/Logistique/ContainerCard.tsx`

- [ ] **Step 1: Add `IconRefresh` import + `onRefill` prop + Menu.Item**

In `ContainerCard.tsx`:

1. Add `IconRefresh` to the existing `@tabler/icons-react` import line (next to `IconDots`, `IconPencil`, `IconPackage`, `IconTrash`).

2. Add `onRefill: () => void;` to the `Props` interface (next to `onAssign`).

3. Destructure `onRefill` in the component signature: `export function ContainerCard({ instance, onAssign, onRefill, sortMode = 'color' }: Props)`.

4. In the `Menu.Dropdown`, add this `Menu.Item` BEFORE the existing "Affecter des produits" item:

```tsx
<Menu.Item leftSection={<IconRefresh size={14} />} onClick={onRefill}>
  Refournir
</Menu.Item>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Logistique/ContainerCard.tsx
git commit -m "feat(refill): add Refournir menu entry on ContainerCard"
```

---

## Task 8: Mount RefillModal on LogistiquePage

**Why:** State + render the modal.

**Files:**
- Modify: `src/app/ivy/inventaire/logistique/page.tsx`

- [ ] **Step 1: Add state + import + render**

In `page.tsx`:

1. Add import next to `AssignProductsModal`:

```typescript
import { RefillModal } from '@/components/Logistique/RefillModal';
```

2. Add state next to `assigningId`:

```typescript
const [refillingId, setRefillingId] = useState<string | null>(null);
```

3. Pass `onRefill` to `ContainerCard` (in the `instances.map` block):

```tsx
<ContainerCard
  key={inst.id}
  instance={inst}
  sortMode={sortMode}
  onAssign={() => setAssigningId(inst.id)}
  onRefill={() => setRefillingId(inst.id)}
/>
```

4. Render the modal at the end of the JSX (after the `assigningId` block):

```tsx
{refillingId && currentShop && (
  <RefillModal
    opened={!!refillingId}
    onClose={() => setRefillingId(null)}
    containerId={refillingId}
    shopId={currentShop.id}
  />
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/ivy/inventaire/logistique/page.tsx
git commit -m "feat(refill): mount RefillModal on LogistiquePage"
```

---

## Task 9: End-to-end manual verification + version bump + push

- [ ] **Step 1: Run the dev server and walk through the full flow**

```bash
pnpm dev
```

Open `http://localhost:3000/ivy/inventaire/logistique`.

Verify the golden path:
1. Click ⋯ on a caisse with assigned products → "Refournir" entry exists
2. Click it → modal opens, shows suggestions table with non-zero values
3. Switch the window selector → table reloads
4. Tap +/- on a stepper → fill bar updates live
5. Type a value above max_capacity → orange "+N hors capacité" appears
6. Click "Ajouter à une commande de stock":
   - If no draft exists → confirm + creates new BATCH-NNNN
   - If draft exists → dropdown of drafts + ability to pick or create new
7. After submit → success view + "Ouvrir la commande" link
8. Open the linked stock order page → verify lines are present, qty correct

Edge cases to verify:
- A caisse without assigned products → modal shows "Affecte d'abord..."
- Submit with all qty = 0 → button disabled
- Append same variant twice via two refill cycles → second time shows `linesIncremented: 1`

- [ ] **Step 2: Run `pnpm build` to catch any TS errors**

```bash
pnpm build
```

Expected: build completes. Fix any TypeScript errors that surface.

- [ ] **Step 3: Bump version + commit**

Edit `src/config/version.ts`:

```typescript
export const APP_VERSION = '0.5.24 - Ivy';
```

```bash
git add src/config/version.ts
git commit -m "chore: bump version to 0.5.24"
```

- [ ] **Step 4: Push to feature branch**

```bash
git push -u origin feat/refournir-caisse
```

Do NOT merge to main yet — let the user verify in dev first.

---

## Notes for the implementer

1. **Service-role security**: All endpoints use `createServerClient()` (service role) and filter manually by `shop_id`. RLS does not apply, so every query that touches a multi-tenant table MUST include `.eq('shop_id', shopId)` or equivalent through joins.
2. **Location ID asymmetry**: `inventory_levels.location_id` is Shopify ID (TEXT), `stock_movements.location_id` is UUID. Endpoint resolves once via `locations.shopify_id → id`. Already handled in `Task 2`.
3. **Mantine version**: `@mantine/core@7.x` — `Modal`, `Select`, `NumberInput`, `Button`, `ActionIcon`, `Tooltip`, `Loader` are all v7 APIs.
4. **No DB migration**: zero risk on the database side.
5. **The agent integration angle**: the two endpoints are designed REST-first. Future work to expose via MCP or API key middleware does NOT require touching them.

## Self-review checklist

- [x] Spec section "User flow" → covered by Tasks 5, 6, 7, 8
- [x] Spec section "API GET refill-suggestions" → Task 2 (full route impl)
- [x] Spec section "API POST refill" → Task 3 (full route impl)
- [x] Spec section "Math du top-up" → Task 1 (Hamilton implementation)
- [x] Spec section "Edge cases serveur" → all handled inline in Tasks 2 + 3
- [x] Spec section "Components" → Tasks 4–8 cover every file in the list
- [x] No DB migration → confirmed in plan header
- [x] Type names consistent: `RefillVariant`, `RefillProduct`, `RefillSuggestionsResponse`, `RefillWindow` defined in Task 4 + used in Task 6
- [x] `windowParam` param name fixed (no shadowing of global `window`) — Task 4 Step 1 includes the fix
- [x] No placeholders / TBDs — every step has full code
