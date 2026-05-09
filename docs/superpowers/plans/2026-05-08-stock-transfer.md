# Transfert de stock entre emplacements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur la fiche produit, permettre de transférer une partie ou la totalité du stock par variante depuis l'emplacement courant vers un autre, avec sync Shopify obligatoire et journalisation dans `stock_movements`.

**Architecture:** Une nouvelle route `POST /api/inventory/transfer` qui orchestre 2 ajustements Shopify opposés + 2 upserts `inventory_levels` + 2 inserts `stock_movements` par variante. Côté UI : nouvelle colonne checkbox dans le tableau des variantes de `ProductDetailView`, barre d'action contextuelle et bouton "Transférer le produit" qui ouvrent un nouveau composant `<TransferModal />` (dropdown destination + qty éditables).

**Tech Stack:** Next.js 16 App Router · React 19 · Mantine 7 · Supabase (service role) · Shopify Admin REST API · TypeScript strict · SCSS modules · pnpm

**Spec:** `docs/superpowers/specs/2026-05-08-stock-transfer-design.md`

**Important note on testing:** Pas de framework de tests dans Ivy (per `CLAUDE.md`). Chaque task se termine par une validation manuelle (curl pour les endpoints, dev server + DevTools + Supabase pour l'UI). Le serveur dev tourne sur **http://localhost:3002** (port 3000 occupé).

---

## Task 1: Helpers Supabase factorisés (`resolveVariantId`, `resolveLocationUuid`)

**Why:** La route `/api/pos/stock/adjust` contient déjà la logique de résolution `Shopify ID → UUID`. La nouvelle route `/transfer` la réutilise. Factoriser maintenant évite la duplication et donne un point unique de maintenance.

**Files:**
- Create: `src/lib/supabase/resolve.ts`
- Modify: `src/app/api/pos/stock/adjust/route.ts`

- [ ] **Step 1: Créer le fichier `resolve.ts`**

```typescript
// src/lib/supabase/resolve.ts
import type { SupabaseClient } from '@supabase/supabase-js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Résout un identifiant de variante (UUID Supabase OU Shopify ID numérique en string)
 * vers son UUID Supabase. Retourne null si introuvable.
 */
export async function resolveVariantId(
  supabase: SupabaseClient,
  variantId: string,
): Promise<string | null> {
  if (isUuid(variantId)) return variantId;

  const { data } = await supabase
    .from('product_variants')
    .select('id')
    .eq('shopify_id', variantId)
    .maybeSingle();

  return data?.id ?? null;
}

/**
 * Résout un identifiant de location (UUID Supabase OU Shopify numeric string)
 * vers son UUID Supabase. Indispensable pour `stock_movements.location_id` qui est
 * une FK UUID vers `locations(id)`. Retourne null si introuvable.
 */
export async function resolveLocationUuid(
  supabase: SupabaseClient,
  locationId: string,
): Promise<string | null> {
  if (isUuid(locationId)) return locationId;

  const { data } = await supabase
    .from('locations')
    .select('id')
    .eq('shopify_id', locationId)
    .maybeSingle();

  return data?.id ?? null;
}

/**
 * Résout un UUID location vers son Shopify ID (TEXT). Inverse de resolveLocationUuid.
 * Utile pour les appels Shopify Admin API.
 */
export async function resolveLocationShopifyId(
  supabase: SupabaseClient,
  locationId: string,
): Promise<string | null> {
  if (!isUuid(locationId)) return locationId;

  const { data } = await supabase
    .from('locations')
    .select('shopify_id')
    .eq('id', locationId)
    .maybeSingle();

  return data?.shopify_id ?? null;
}
```

- [ ] **Step 2: Refactor `/api/pos/stock/adjust/route.ts` pour utiliser les helpers**

Remplacer la fonction `resolveVariantId` locale et la résolution inline de `locationUuid` :

```typescript
// Au début du fichier (ajout d'import)
import { resolveVariantId, resolveLocationUuid, resolveLocationShopifyId } from '@/lib/supabase/resolve';

// Supprimer la fonction `async function resolveVariantId(...)` locale (lignes 10-21).

// Dans POST handler, remplacer le bloc de résolution locationUuid (lignes 52-65) par :
let locationUuid: string | null = null;
if (locationId) {
  locationUuid = await resolveLocationUuid(supabase, locationId);
}

// Dans la boucle, remplacer l'appel `resolveVariantId(item.variantId)` par :
const resolvedVariantId = await resolveVariantId(supabase, item.variantId);

// Dans la résolution Shopify location ID (lignes 146-155), remplacer par :
let shopifyLocationId = locationId;
if (isUuid(locationId)) {
  shopifyLocationId = await resolveLocationShopifyId(supabase, locationId) ?? locationId;
}
// (et ajouter `import { isUuid } from '@/lib/supabase/resolve';` à l'import existant)
```

- [ ] **Step 3: Vérifier que le build TypeScript passe**

Run: `pnpm build`
Expected: Build successful, pas d'erreurs TS sur `route.ts`.

- [ ] **Step 4: Validation manuelle — un ajustement fonctionne toujours**

Sur http://localhost:3002, ouvrir une fiche produit, modifier une quantité de variante et cliquer "Sauvegarder". Vérifier dans Supabase que `inventory_levels` et `stock_movements` reflètent le changement (comportement non régressé).

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/resolve.ts src/app/api/pos/stock/adjust/route.ts
git commit -m "refactor(supabase): factorise resolveVariantId et resolveLocationUuid en helpers"
```

---

## Task 2: Backend — `POST /api/inventory/transfer`

**Why:** Le cœur métier du transfert. Encapsule garde-fou stock négatif, dual-call Shopify, upserts inventory_levels et logging stock_movements en une seule requête atomique côté client.

**Files:**
- Create: `src/app/api/inventory/transfer/route.ts`

- [ ] **Step 1: Implémenter la route**

```typescript
// src/app/api/inventory/transfer/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  resolveVariantId,
  resolveLocationUuid,
  resolveLocationShopifyId,
  isUuid,
} from '@/lib/supabase/resolve';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface TransferItem {
  variantId: string;
  quantity: number;
  productTitle: string;
  variantTitle?: string;
}

interface TransferRequest {
  shopId: string;
  sourceLocationId: string;
  destLocationId: string;
  items: TransferItem[];
}

interface ItemResult {
  variantId: string;
  success: boolean;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TransferRequest;
    const { shopId, sourceLocationId, destLocationId, items } = body;

    if (!shopId || !sourceLocationId || !destLocationId || !items || items.length === 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (sourceLocationId === destLocationId) {
      return NextResponse.json(
        { error: 'Source and destination must differ' },
        { status: 400 },
      );
    }

    if (items.some((it) => !it.variantId || !it.quantity || it.quantity <= 0)) {
      return NextResponse.json(
        { error: 'Each item needs a positive quantity and a variantId' },
        { status: 400 },
      );
    }

    // Résolution des IDs en début de requête (1 fois)
    const sourceLocationUuid = await resolveLocationUuid(supabase, sourceLocationId);
    const destLocationUuid = await resolveLocationUuid(supabase, destLocationId);

    // Conversion vers Shopify ID (TEXT) pour inventory_levels et appels Shopify
    const sourceLocationShopifyId = isUuid(sourceLocationId)
      ? await resolveLocationShopifyId(supabase, sourceLocationId)
      : sourceLocationId;
    const destLocationShopifyId = isUuid(destLocationId)
      ? await resolveLocationShopifyId(supabase, destLocationId)
      : destLocationId;

    if (!sourceLocationShopifyId || !destLocationShopifyId) {
      return NextResponse.json({ error: 'Location resolution failed' }, { status: 400 });
    }

    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('shopify_url, shopify_token')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }

    const results: ItemResult[] = [];
    const today = new Date().toISOString().split('T')[0];

    for (const item of items) {
      try {
        const resolvedVariantId = await resolveVariantId(supabase, item.variantId);
        if (!resolvedVariantId) {
          results.push({ variantId: item.variantId, success: false, error: 'Variant not found' });
          continue;
        }

        const { data: variant, error: variantError } = await supabase
          .from('product_variants')
          .select('id, inventory_item_id')
          .eq('id', resolvedVariantId)
          .single();

        if (variantError || !variant) {
          results.push({ variantId: item.variantId, success: false, error: 'Variant not found' });
          continue;
        }

        // Garde-fou stock négatif au source
        const { data: sourceLevel } = await supabase
          .from('inventory_levels')
          .select('quantity')
          .eq('variant_id', resolvedVariantId)
          .eq('location_id', sourceLocationShopifyId)
          .maybeSingle();

        const sourceQty = Math.max(0, sourceLevel?.quantity ?? 0);
        if (item.quantity > sourceQty) {
          results.push({
            variantId: item.variantId,
            success: false,
            error: `Stock insuffisant : ${sourceQty} dispo, demandé ${item.quantity}`,
          });
          continue;
        }

        // Sync Shopify (skip si variante purement locale, inventory_item_id null)
        if (variant.inventory_item_id) {
          const adjustEndpoint = `https://${shop.shopify_url}/admin/api/2024-01/inventory_levels/adjust.json`;
          const headers = {
            'X-Shopify-Access-Token': shop.shopify_token,
            'Content-Type': 'application/json',
          };

          const sourceResponse = await fetch(adjustEndpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              location_id: sourceLocationShopifyId,
              inventory_item_id: variant.inventory_item_id,
              available_adjustment: -item.quantity,
            }),
          });

          if (!sourceResponse.ok) {
            const err = await sourceResponse.json().catch(() => ({}));
            console.error('Shopify source adjust failed:', err);
            results.push({
              variantId: item.variantId,
              success: false,
              error: `Shopify source sync failed: ${sourceResponse.status}`,
            });
            continue;
          }

          const destResponse = await fetch(adjustEndpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              location_id: destLocationShopifyId,
              inventory_item_id: variant.inventory_item_id,
              available_adjustment: item.quantity,
            }),
          });

          if (!destResponse.ok) {
            const err = await destResponse.json().catch(() => ({}));
            console.error('Shopify dest adjust failed:', err);
            results.push({
              variantId: item.variantId,
              success: false,
              error: `Shopify dest sync failed (source already adjusted): ${destResponse.status}`,
            });
            continue;
          }
        }

        // Upsert inventory_levels source (qty − transferQty)
        const newSourceQty = sourceQty - item.quantity;
        const { error: srcUpdateError } = await supabase
          .from('inventory_levels')
          .upsert(
            {
              variant_id: resolvedVariantId,
              location_id: sourceLocationShopifyId,
              quantity: newSourceQty,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'variant_id,location_id' },
          );
        if (srcUpdateError) {
          console.error('inventory_levels source upsert failed:', srcUpdateError);
        }

        // Upsert inventory_levels dest (qty_existante + transferQty)
        const { data: destLevel } = await supabase
          .from('inventory_levels')
          .select('quantity')
          .eq('variant_id', resolvedVariantId)
          .eq('location_id', destLocationShopifyId)
          .maybeSingle();
        const newDestQty = (destLevel?.quantity ?? 0) + item.quantity;
        const { error: destUpdateError } = await supabase
          .from('inventory_levels')
          .upsert(
            {
              variant_id: resolvedVariantId,
              location_id: destLocationShopifyId,
              quantity: newDestQty,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'variant_id,location_id' },
          );
        if (destUpdateError) {
          console.error('inventory_levels dest upsert failed:', destUpdateError);
        }

        // Log stock_movements (− au source, + au dest, agrégés par jour comme /adjust)
        await upsertDailyMovement(shopId, sourceLocationUuid, resolvedVariantId, item, -item.quantity, today);
        await upsertDailyMovement(shopId, destLocationUuid, resolvedVariantId, item, item.quantity, today);

        results.push({ variantId: item.variantId, success: true });
      } catch (itemError) {
        console.error('Transfer item error:', itemError);
        results.push({ variantId: item.variantId, success: false, error: 'Processing error' });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const allSuccess = successCount === items.length;

    return NextResponse.json({
      success: allSuccess,
      message: `${successCount}/${items.length} variante(s) transférée(s)`,
      results,
    });
  } catch (error) {
    console.error('POST /api/inventory/transfer:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Upsert d'un mouvement de stock pour une variante + location + jour donnés.
 * Si une ligne existe déjà pour ce trio, on additionne ; sinon on insère.
 * Reproduit le comportement d'agrégation journalière de /api/pos/stock/adjust.
 */
async function upsertDailyMovement(
  shopId: string,
  locationUuid: string | null,
  variantId: string,
  item: TransferItem,
  delta: number,
  movedOn: string,
) {
  let existingQuery = supabase
    .from('stock_movements')
    .select('id, quantity')
    .eq('shop_id', shopId)
    .eq('variant_id', variantId)
    .eq('moved_on', movedOn);

  if (locationUuid) {
    existingQuery = existingQuery.eq('location_id', locationUuid);
  } else {
    existingQuery = existingQuery.is('location_id', null);
  }

  const { data: existing } = await existingQuery.maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('stock_movements')
      .update({ quantity: existing.quantity + delta })
      .eq('id', existing.id);
    if (error) console.error('stock_movements update failed:', error);
  } else {
    const { error } = await supabase.from('stock_movements').insert({
      shop_id: shopId,
      location_id: locationUuid,
      variant_id: variantId,
      product_title: item.productTitle,
      variant_title: item.variantTitle ?? null,
      quantity: delta,
      moved_on: movedOn,
    });
    if (error) console.error('stock_movements insert failed:', error);
  }
}
```

- [ ] **Step 2: Vérifier que le build TypeScript passe**

Run: `pnpm build`
Expected: Build successful, route.ts inclus dans la liste des routes générées.

- [ ] **Step 3: Validation manuelle via curl**

Récupérer un `shopId`, deux `locationId` Shopify (TEXT) et un `variantId` (UUID Supabase ou Shopify ID) depuis Supabase admin ou les DevTools de l'app.

```bash
curl -X POST http://localhost:3002/api/inventory/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "shopId": "<UUID_SHOP>",
    "sourceLocationId": "<SHOPIFY_ID_SOURCE>",
    "destLocationId": "<SHOPIFY_ID_DEST>",
    "items": [
      { "variantId": "<VARIANT_ID>", "quantity": 1, "productTitle": "Test Transfer", "variantTitle": "M / Bleu" }
    ]
  }'
```

Expected response (succès) :
```json
{ "success": true, "message": "1/1 variante(s) transférée(s)", "results": [{ "variantId": "...", "success": true }] }
```

Vérifier dans Supabase :
- `inventory_levels` source : `quantity` décrémenté de 1
- `inventory_levels` dest : `quantity` incrémenté de 1 (ou ligne créée si inexistante)
- `stock_movements` : 2 lignes (une à -1 au source, une à +1 au dest) pour aujourd'hui

Vérifier dans Shopify admin (si la variante est synchro) : stock à jour aux 2 endroits.

- [ ] **Step 4: Validation garde-fou stock négatif**

Tenter le même curl avec une `quantity` supérieure au stock dispo source.

Expected response :
```json
{
  "success": false,
  "results": [{ "variantId": "...", "success": false, "error": "Stock insuffisant : <N> dispo, demandé <M>" }]
}
```

Vérifier qu'aucune écriture n'a été faite (Supabase + Shopify inchangés).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/inventory/transfer/route.ts
git commit -m "feat(inventory): route POST /api/inventory/transfer (Shopify + supabase)"
```

---

## Task 3: Frontend — `<TransferModal />`

**Why:** Composant modal réutilisable, isolé de `ProductDetailView`. Affiche le dropdown destination, le récap des variantes sélectionnées avec qty éditable, et déclenche l'appel `/api/inventory/transfer`.

**Files:**
- Create: `src/components/Inventory/TransferModal.tsx`
- Create: `src/components/Inventory/TransferModal.module.scss`

- [ ] **Step 1: Créer le fichier SCSS**

```scss
// src/components/Inventory/TransferModal.module.scss
.modalTitle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.variantTable {
  width: 100%;
  border-collapse: collapse;

  th {
    text-align: left;
    font-size: 0.8rem;
    color: var(--mantine-color-slate-6);
    padding: 6px 8px;
    border-bottom: 1px solid var(--divider);
  }

  td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--divider-soft);
    font-size: 0.85rem;
    color: var(--mantine-color-slate-8);
  }

  td.qtyCell {
    text-align: right;
  }
}

.totalLine {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--mantine-color-slate-8);
}
```

- [ ] **Step 2: Implémenter `TransferModal.tsx`**

```tsx
// src/components/Inventory/TransferModal.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal, Select, NumberInput, Button, Group, Stack, Text, Loader } from '@mantine/core';
import { IconArrowsExchange } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useLocation } from '@/context/LocationContext';
import type { ProductData } from './ProductCard';
import styles from './TransferModal.module.scss';

interface TransferModalProps {
  opened: boolean;
  onClose: () => void;
  product: ProductData;
  selectedVariantIds: Set<string>;
  shopId: string | undefined;
  sourceLocationId: string | undefined;
  sourceLocationName: string | undefined;
  onSuccess: (transferred: { variantId: string; quantity: number }[]) => void;
}

export function TransferModal({
  opened,
  onClose,
  product,
  selectedVariantIds,
  shopId,
  sourceLocationId,
  sourceLocationName,
  onSuccess,
}: TransferModalProps) {
  const { locations } = useLocation();
  const [destLocationId, setDestLocationId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  const selectedVariants = useMemo(
    () => product.variants.filter((v) => selectedVariantIds.has(v.id)),
    [product.variants, selectedVariantIds],
  );

  // Initialiser quantities = qty dispo dès l'ouverture
  useEffect(() => {
    if (opened) {
      const initial: Record<string, number> = {};
      for (const v of selectedVariants) {
        initial[v.id] = Math.max(0, v.quantity);
      }
      setQuantities(initial);
      setDestLocationId(null);
    }
  }, [opened, selectedVariants]);

  const destOptions = useMemo(
    () =>
      locations
        .filter((loc) => loc.id !== sourceLocationId)
        .map((loc) => ({ value: loc.id, label: loc.name })),
    [locations, sourceLocationId],
  );

  const totalToTransfer = useMemo(
    () => Object.values(quantities).reduce((sum, q) => sum + q, 0),
    [quantities],
  );

  const destLocationName = useMemo(
    () => locations.find((loc) => loc.id === destLocationId)?.name ?? '',
    [locations, destLocationId],
  );

  const handleQuantityChange = (variantId: string, value: number, max: number) => {
    setQuantities((prev) => ({
      ...prev,
      [variantId]: Math.max(0, Math.min(max, value)),
    }));
  };

  const handleSubmit = async () => {
    if (!shopId || !sourceLocationId || !destLocationId) return;

    const items = selectedVariants
      .filter((v) => (quantities[v.id] ?? 0) > 0)
      .map((v) => ({
        variantId: v.id,
        quantity: quantities[v.id],
        productTitle: product.title,
        variantTitle: v.title ?? undefined,
      }));

    if (items.length === 0) {
      notifications.show({
        title: 'Aucune variante à transférer',
        message: 'Toutes les quantités sont à zéro',
        color: 'clay',
      });
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/inventory/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, sourceLocationId, destLocationId, items }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? 'Erreur de transfert');
      }

      const successResults: { variantId: string; success: boolean }[] = data.results ?? [];
      const successfulVariantIds = new Set(
        successResults.filter((r) => r.success).map((r) => r.variantId),
      );
      const transferred = items
        .filter((it) => successfulVariantIds.has(it.variantId))
        .map((it) => ({ variantId: it.variantId, quantity: it.quantity }));

      const failedCount = items.length - transferred.length;

      if (failedCount === 0) {
        notifications.show({
          title: 'Transfert réussi',
          message: `${totalToTransfer} unité(s) de ${transferred.length} variante(s) transférée(s) vers ${destLocationName}`,
          color: 'moss',
        });
      } else if (transferred.length === 0) {
        const firstError = successResults.find((r) => !r.success)?.error ?? 'Erreur inconnue';
        notifications.show({
          title: 'Transfert échoué',
          message: firstError,
          color: 'rust',
        });
      } else {
        notifications.show({
          title: 'Transfert partiel',
          message: `${transferred.length}/${items.length} variante(s) transférée(s) — ${failedCount} échec(s)`,
          color: 'clay',
        });
      }

      onSuccess(transferred);
      if (failedCount === 0) {
        onClose();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Une erreur est survenue';
      notifications.show({ title: 'Erreur', message, color: 'rust' });
    } finally {
      setSubmitting(false);
    }
  };

  const submitLabel = destLocationId
    ? `Transférer ${totalToTransfer} unité${totalToTransfer > 1 ? 's' : ''} vers ${destLocationName}`
    : 'Choisir une destination';

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      radius="lg"
      size="lg"
      centered
      title={
        <span className={styles.modalTitle}>
          <IconArrowsExchange size={18} />
          Transférer le stock
        </span>
      }
    >
      <Stack gap="md">
        <Text size="sm" c="slate.7">
          Depuis <Text span fw={600}>{sourceLocationName ?? '—'}</Text>
        </Text>

        <Select
          label="Vers l'emplacement"
          placeholder="Choisir une destination"
          data={destOptions}
          value={destLocationId}
          onChange={setDestLocationId}
          searchable
          nothingFoundMessage="Aucun autre emplacement"
          disabled={submitting}
        />

        <table className={styles.variantTable}>
          <thead>
            <tr>
              <th>Variante</th>
              <th>Dispo</th>
              <th style={{ textAlign: 'right' }}>Qty à transférer</th>
            </tr>
          </thead>
          <tbody>
            {selectedVariants.map((v) => {
              const dispo = Math.max(0, v.quantity);
              return (
                <tr key={v.id}>
                  <td>{v.title ?? '—'}</td>
                  <td>{dispo}</td>
                  <td className={styles.qtyCell}>
                    <NumberInput
                      value={quantities[v.id] ?? 0}
                      onChange={(val) =>
                        handleQuantityChange(v.id, typeof val === 'number' ? val : 0, dispo)
                      }
                      min={0}
                      max={dispo}
                      hideControls
                      disabled={submitting || dispo === 0}
                      styles={{ input: { width: 80, textAlign: 'right' } }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className={styles.totalLine}>
          <span>Total</span>
          <span>{totalToTransfer} unité{totalToTransfer > 1 ? 's' : ''}</span>
        </div>

        <Group justify="flex-end" gap="sm" mt="md">
          <Button variant="default" color="slate" onClick={onClose} disabled={submitting}>
            Annuler
          </Button>
          <Button
            color="moss"
            leftSection={submitting ? <Loader size={14} color="white" /> : <IconArrowsExchange size={16} />}
            onClick={handleSubmit}
            disabled={!destLocationId || totalToTransfer === 0 || submitting}
          >
            {submitting ? 'Transfert…' : submitLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
```

- [ ] **Step 3: Vérifier que le build TypeScript passe**

Run: `pnpm build`
Expected: Build successful, pas d'erreur sur les imports ou les types.

- [ ] **Step 4: Commit**

```bash
git add src/components/Inventory/TransferModal.tsx src/components/Inventory/TransferModal.module.scss
git commit -m "feat(inventory): composant TransferModal (dropdown destination + qty editable)"
```

---

## Task 4: Intégration dans `ProductDetailView`

**Why:** Brancher la couche UI : checkboxes par ligne, header tri-state, barre d'action contextuelle, bouton "Transférer le produit", ouverture du `<TransferModal />` et rafraîchissement local après succès.

**Files:**
- Modify: `src/components/Inventory/ProductDetailView.tsx`

- [ ] **Step 1: Ajouter les imports**

Au top du fichier, modifier la ligne d'import Mantine pour ajouter `Checkbox` :

```tsx
import { Button, Text, Badge, Group, Stack, Table, Image, NumberInput, ActionIcon, Loader, Modal, Paper, Checkbox } from '@mantine/core';
```

Et la ligne d'import des icônes pour ajouter `IconArrowsExchange` :

```tsx
import { IconArrowLeft, IconPhoto, IconPlus, IconMinus, IconDeviceFloppy, IconTrash, IconRefresh, IconArchive, IconUpload, IconArrowsExchange } from '@tabler/icons-react';
```

Importer le nouveau composant juste après les autres imports `@/components/Inventory` :

```tsx
import { TransferModal } from './TransferModal';
import { useLocation } from '@/context/LocationContext';
```

- [ ] **Step 2: Ajouter les états et derived values**

Juste après l'état `pushing` (vers la ligne 55), ajouter :

```tsx
const [selectedVariantIds, setSelectedVariantIds] = useState<Set<string>>(new Set());
const [transferModalOpened, { open: openTransferModal, close: closeTransferModal }] = useDisclosure(false);
const { currentLocation } = useLocation();
```

Et un derived value pour la checkbox tri-state du header (à ajouter à proximité de `sortedVariants`, après le `useMemo` de `sortedVariants`) :

```tsx
const allVariantsSelected =
  sortedVariants.length > 0 && sortedVariants.every((v) => selectedVariantIds.has(v.id));
const someVariantsSelected =
  selectedVariantIds.size > 0 && !allVariantsSelected;
```

- [ ] **Step 3: Ajouter les handlers de sélection**

Juste après `handleDecrement` (vers la ligne 356), ajouter :

```tsx
// Toggle d'une variante dans la sélection
const toggleVariantSelection = (variantId: string) => {
  setSelectedVariantIds((prev) => {
    const next = new Set(prev);
    if (next.has(variantId)) {
      next.delete(variantId);
    } else {
      next.add(variantId);
    }
    return next;
  });
};

// Toggle de toutes les variantes
const toggleAllVariants = () => {
  setSelectedVariantIds((prev) => {
    if (prev.size === sortedVariants.length) {
      return new Set();
    }
    return new Set(sortedVariants.map((v) => v.id));
  });
};

// Sélectionner toutes et ouvrir le modal (bouton "Transférer le produit")
const handleTransferAllProduct = () => {
  setSelectedVariantIds(new Set(sortedVariants.map((v) => v.id)));
  openTransferModal();
};

// Callback après succès du modal : décrémenter les quantités source localement
const handleTransferSuccess = (
  transferred: { variantId: string; quantity: number }[],
) => {
  if (!onProductUpdated || transferred.length === 0) return;

  const transferMap = new Map(transferred.map((t) => [t.variantId, t.quantity]));
  const updatedVariants = product.variants.map((v) => {
    const delta = transferMap.get(v.id);
    if (delta === undefined) return v;
    return { ...v, quantity: Math.max(0, v.quantity - delta) };
  });

  setQuantities((prev) => {
    const next = { ...prev };
    for (const v of updatedVariants) {
      next[v.id] = v.quantity;
    }
    return next;
  });

  onProductUpdated({
    ...product,
    variants: updatedVariants,
    totalQuantity: updatedVariants.reduce((s, v) => s + Math.max(0, v.quantity), 0),
    sizeBreakdown: updatedVariants.reduce((acc, v) => {
      if (v.size) acc[v.size] = (acc[v.size] || 0) + Math.max(0, v.quantity);
      return acc;
    }, {} as Record<string, number>),
  });

  // Retirer les variantes transférées de la sélection (qty source pourrait être 0)
  setSelectedVariantIds((prev) => {
    const next = new Set(prev);
    for (const id of transferMap.keys()) next.delete(id);
    return next;
  });
};
```

- [ ] **Step 4: Ajouter les boutons "Transférer" dans le header**

Dans le `<Group gap="xs">` du header (vers la ligne 548), ajouter le bouton **"Transférer le produit"** juste après le bouton "Pousser vers Shopify" (ligne ~568) :

```tsx
<Button
  variant="light"
  color="moss"
  leftSection={<IconArrowsExchange size={16} />}
  onClick={handleTransferAllProduct}
  disabled={saving || syncing || pushing || product.totalQuantity === 0}
  size="sm"
>
  Transférer le produit
</Button>
```

Et la barre d'action contextuelle (à insérer juste avant ce nouveau bouton, pour qu'elle apparaisse à gauche dans le Group) :

```tsx
{selectedVariantIds.size > 0 && (
  <>
    <Button
      color="moss.7"
      leftSection={<IconArrowsExchange size={16} />}
      onClick={openTransferModal}
      disabled={saving || syncing}
      size="sm"
    >
      Transférer {selectedVariantIds.size} variante{selectedVariantIds.size > 1 ? 's' : ''} →
    </Button>
    <Button
      variant="subtle"
      color="slate"
      onClick={() => setSelectedVariantIds(new Set())}
      size="sm"
    >
      Désélectionner
    </Button>
  </>
)}
```

- [ ] **Step 5: Ajouter la colonne checkbox dans le tableau**

Modifier le `<Table.Thead>` (vers la ligne 720) pour ajouter une `<Table.Th>` checkbox en première colonne :

```tsx
<Table.Thead>
  <Table.Tr>
    <Table.Th style={{ width: 32 }}>
      <Checkbox
        checked={allVariantsSelected}
        indeterminate={someVariantsSelected}
        onChange={toggleAllVariants}
        aria-label="Sélectionner toutes les variantes"
      />
    </Table.Th>
    <Table.Th>Variante</Table.Th>
    <Table.Th>SKU</Table.Th>
    <Table.Th style={{ textAlign: 'center' }}>État</Table.Th>
    <Table.Th style={{ textAlign: 'right' }}>Coût</Table.Th>
    <Table.Th style={{ textAlign: 'right' }}>Prix</Table.Th>
    <Table.Th>Métachamps</Table.Th>
    <Table.Th style={{ textAlign: 'right' }}>Quantité</Table.Th>
  </Table.Tr>
</Table.Thead>
```

Modifier le `<Table.Tbody>` pour ajouter une `<Table.Td>` checkbox en première colonne de chaque ligne (vers la ligne 732, juste avant `<Table.Td className={styles.variantName}>`) :

```tsx
{sortedVariants.map((variant) => (
  <Table.Tr key={variant.id}>
    <Table.Td>
      <Checkbox
        checked={selectedVariantIds.has(variant.id)}
        onChange={() => toggleVariantSelection(variant.id)}
        aria-label={`Sélectionner ${variant.title ?? 'la variante'}`}
      />
    </Table.Td>
    {/* ... le reste des Table.Td existants reste inchangé ... */}
  </Table.Tr>
))}
```

- [ ] **Step 6: Insérer le `<TransferModal />` à la fin du JSX**

Juste avant la fermeture `</div>` du conteneur principal (à proximité du dernier `<Modal>` existant, vers la ligne 970), ajouter :

```tsx
<TransferModal
  opened={transferModalOpened}
  onClose={closeTransferModal}
  product={product}
  selectedVariantIds={selectedVariantIds}
  shopId={shopId}
  sourceLocationId={locationId}
  sourceLocationName={currentLocation?.name ?? locationName}
  onSuccess={handleTransferSuccess}
/>
```

- [ ] **Step 7: Vérifier que le build TypeScript passe**

Run: `pnpm build`
Expected: Build successful, pas d'erreur dans `ProductDetailView.tsx`.

- [ ] **Step 8: Validation manuelle UI**

Sur http://localhost:3002 :

1. Ouvrir une fiche produit → vérifier que la colonne checkbox apparaît à gauche du tableau, que le header de colonne a une checkbox tri-state.
2. Cocher 2 variantes → la barre d'action `Transférer 2 variantes →` apparaît dans le header. Cliquer dessus → modal s'ouvre avec dropdown destination et 2 lignes pré-remplies à dispo.
3. Cliquer "Désélectionner" → la barre d'action disparaît, les checkboxes se vident.
4. Cliquer "Transférer le produit" → toutes les variantes pré-cochées dans le modal.
5. Cliquer "Sauvegarder" la checkbox du header (tri-state) → toutes les lignes se cochent ; recliquer → toutes se décochent.
6. Le bouton "Transférer le produit" doit être désactivé si `totalQuantity === 0`.

- [ ] **Step 9: Commit**

```bash
git add src/components/Inventory/ProductDetailView.tsx
git commit -m "feat(inventory): checkboxes + bouton transfert + modal dans ProductDetailView"
```

---

## Task 5: Validation E2E + bump version + push

**Why:** Confirmer que le flow complet fonctionne en production-like avant de pousser sur la branche feature. Bumper APP_VERSION (préférence globale).

**Files:**
- Modify: `src/config/version.ts`

- [ ] **Step 1: Validation manuelle complète**

Sur http://localhost:3002 :

1. **Golden path** : ouvrir un produit avec stock > 0, cocher 2 variantes, cliquer `Transférer 2 variantes →`, choisir une destination, vérifier que le total et le label du bouton sont corrects, valider. Notification verte. Vérifier dans Supabase :
   - `inventory_levels` source : qty décrémentée
   - `inventory_levels` dest : qty incrémentée (ou ligne créée)
   - `stock_movements` : 2 lignes (une − au source, une + au dest) avec `moved_on = today`
   - Shopify admin : stock à jour aux 2 endroits
2. **Bouton produit** : cliquer "Transférer le produit", valider tout vers une destination. Vérifier que toutes les quantités source passent à 0 dans la fiche produit sans refresh.
3. **Édition qty dans modal** : transférer 5/10 → la fiche source affiche 5 unités, la dest a +5.
4. **Garde-fou stock** : forcer `quantity > dispo` via DevTools (modifier le `value` du NumberInput dans le DOM avant submit) → notification rouge avec message "Stock insuffisant", aucune écriture Supabase ou Shopify.
5. **Variante locale** : transférer une variante avec `shopifyActive=false` → succès, pas d'appel Shopify dans Network panel, écritures Supabase OK.
6. **Variante absente au dest** : choisir une location qui n'a jamais eu cette variante → ligne créée dans `inventory_levels`.
7. **Désélectionner** : cocher des variantes, cliquer "Désélectionner" → tout se vide, barre d'action disparaît.

- [ ] **Step 2: Bumper APP_VERSION**

```typescript
// src/config/version.ts
export const APP_VERSION = '0.5.70 - Ivy';
```

- [ ] **Step 3: Vérifier le build de prod**

Run: `pnpm build`
Expected: Build successful.

- [ ] **Step 4: Commit version + push**

```bash
git add src/config/version.ts
git commit -m "chore(version): bump APP_VERSION to 0.5.70"
git push -u origin feat/stock-transfer
```

- [ ] **Step 5: Annoncer la fin**

La branche `feat/stock-transfer` est poussée. Le user peut la merger sur `main` (ce qui déclenchera l'auto-deploy Netlify) quand il est prêt.

---

## Couverture du spec

- ✅ Section 1 (Composants UI) → Task 4 (checkboxes, header tri-state, barre d'action, bouton "Transférer le produit")
- ✅ Section 1 (TransferModal) → Task 3
- ✅ Section 2 (Backend `/api/inventory/transfer`, garde-fou, dual-call Shopify, upserts, stock_movements) → Task 2
- ✅ Section 2 (helpers résolution réutilisables) → Task 1
- ✅ Section 3 (Edge cases) → couverts dans Task 2 (route serveur) et Task 5 (validation manuelle)
- ✅ Section 4 (Validation manuelle) → Task 5
