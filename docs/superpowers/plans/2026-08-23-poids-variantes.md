# Poids des variantes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à chaque variante un poids unitaire fiable dans Ivy — synchronisé depuis Shopify quand il existe, déduit d'une pesée de référence quand il manque — pour que la déclaration douanière suisse puisse s'appuyer dessus.

**Architecture :** Une colonne `product_variants.weight_grams` alimentée par trois voies : la sync Shopify (92 % du catalogue), une règle par type de produit (`weight_type_rules` : une taille pesée + une variation cumulée par cran de taille) appliquée en masse, et une saisie unitaire pour les exceptions. Toute écriture est poussée vers Shopify quand la variante le permet.

**Tech Stack :** Next.js 16 (App Router), React 19, Mantine 7, Supabase (service_role côté API), Shopify Admin API GraphQL 2026-01, pnpm.

**Spec :** `docs/superpowers/specs/2026-08-23-douane-suisse-design.md`

## Global Constraints

- **pnpm** uniquement, jamais npm/yarn.
- **TypeScript strict** — pas de `any`.
- Path alias `@/*` → `./src/*`.
- Multi-tenant : toute requête DB filtre par `shop_id`. Les routes API utilisent `SUPABASE_SERVICE_ROLE_KEY` et contournent donc RLS — le filtrage est à la charge du code.
- Migrations SQL numérotées dans `supabase/migrations/`. **Canal unique : `npx supabase db push --linked`.** Jamais le MCP `apply_migration`, jamais le dashboard.
- `APP_VERSION` (`src/config/version.ts`) : patch +1 à chaque commit touchant `src/`. Version de départ de ce plan : `0.5.108`.
- Branche `feat/douane-suisse`. `main` auto-deploy sur Netlify — ne jamais pousser sur `main` avant validation.
- Écriture Shopify : toujours vérifier `inventory_item_id` présent **et** `shopify_active !== false`. Shopify d'abord, Ivy ensuite.
- **Pas de framework de tests dans ce projet.** La vérification de chaque tâche se fait par `npx tsc --noEmit`, `pnpm build`, et des scripts jetables Node exécutés contre les vraies données. Chaque tâche indique la commande et la sortie attendue.

## Données de référence (mesurées le 2026-08-23)

Ces chiffres servent d'oracle aux vérifications. Ils bougeront si le catalogue change.

- Catalogue : 4 910 variantes, dont **4 502 avec un `grams` > 0** sur Shopify.
- Sans poids : 408, concentrées sur `Le Zippé` (324/804), `L'Essentiel` (0/30), `Invisible` (0/28).
- Emplacement `Uriel (Boxer)` (shopify_id `80953442571`) : 489 lignes de stock, 1 070 pièces, dont **116 pièces sans poids** — 96 sur des variantes `shopify_active = false`, 20 sur des vestes zippées.

## File Structure

| Fichier | Responsabilité |
|---|---|
| `supabase/migrations/050_variant_weight.sql` | Colonne `weight_grams` |
| `supabase/migrations/051_weight_type_rules.sql` | Table des règles de poids par type |
| `src/lib/weights/sizes.ts` | Échelle des tailles, normalisation, distance, calcul du poids déduit. Aucune dépendance. |
| `src/lib/shopify/weight.ts` | Pousse un poids vers Shopify (`inventoryItemUpdate`). Seul endroit qui parle à Shopify pour le poids. |
| `src/app/api/settings/weight-rules/route.ts` | GET / PUT / DELETE des règles par type |
| `src/app/api/settings/weight-rules/apply/route.ts` | Applique une règle (ou toutes) aux variantes |
| `src/app/api/inventory/variants/[id]/weight/route.ts` | Poids d'une variante unique |
| `src/app/parametres/poids/page.tsx` | La grille + la liste d'exceptions |
| `src/app/api/inventory/sync/route.ts` | *(modifié)* Récupère `grams` sans écraser une saisie manuelle |
| `src/layout/ParametresLayout.tsx` | *(modifié)* Entrée de menu « Poids » |

---

### Task 1 : Les deux migrations

**Files:**
- Create: `supabase/migrations/050_variant_weight.sql`
- Create: `supabase/migrations/051_weight_type_rules.sql`

**Interfaces:**
- Produces : colonne `product_variants.weight_grams INTEGER NULL` ; table `weight_type_rules(shop_id, product_type, reference_size, reference_grams, step_pct)`.

- [ ] **Step 1 : Écrire `050_variant_weight.sql`**

```sql
-- Poids unitaire d'une variante, en grammes.
-- NULL = inconnu (bloque la déclaration douanière). 0 n'est jamais une valeur valide.
ALTER TABLE product_variants
ADD COLUMN IF NOT EXISTS weight_grams INTEGER;

COMMENT ON COLUMN product_variants.weight_grams IS
  'Poids unitaire en grammes. Source : sync Shopify (variant.grams) si > 0, sinon règle de type appliquée, sinon saisie manuelle. NULL = inconnu.';

CREATE INDEX IF NOT EXISTS idx_product_variants_weight_null
  ON product_variants(product_id) WHERE weight_grams IS NULL;
```

- [ ] **Step 2 : Écrire `051_weight_type_rules.sql`**

```sql
-- Une règle par type de produit : on pèse UNE taille, les autres se déduisent
-- par une variation cumulée d'un cran de taille à l'autre.
CREATE TABLE IF NOT EXISTS weight_type_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL,

  reference_size TEXT NOT NULL,
  reference_grams INTEGER NOT NULL CHECK (reference_grams > 0),
  step_pct DECIMAL(5, 2) NOT NULL DEFAULT 8,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, product_type)
);

CREATE INDEX IF NOT EXISTS idx_weight_type_rules_shop ON weight_type_rules(shop_id);

ALTER TABLE weight_type_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view weight rules of their shops" ON weight_type_rules
  FOR SELECT USING (
    shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert weight rules for their shops" ON weight_type_rules
  FOR INSERT WITH CHECK (
    shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update weight rules of their shops" ON weight_type_rules
  FOR UPDATE USING (
    shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete weight rules of their shops" ON weight_type_rules
  FOR DELETE USING (
    shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid())
  );
```

- [ ] **Step 3 : Pousser les migrations**

Run: `npx supabase db push --linked`
Expected: les deux fichiers listés comme appliqués, aucune erreur.

- [ ] **Step 4 : Vérifier que la colonne existe**

Run:
```bash
node -e "
const fs=require('fs');
const env={};for(const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)\$/);if(m)env[m[1]]=m[2].trim()}
fetch(env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/product_variants?select=id,weight_grams&limit=1',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d)));
"
```
Expected: un objet avec les clés `id` et `weight_grams` (valeur `null`). Si la réponse contient `column ... does not exist`, la migration n'est pas passée.

- [ ] **Step 5 : Commit**

```bash
git add supabase/migrations/050_variant_weight.sql supabase/migrations/051_weight_type_rules.sql
git commit -m "feat(poids): colonne weight_grams et table weight_type_rules"
```

---

### Task 2 : La sync remonte le poids de Shopify

C'est la tâche qui remplit 4 502 variantes d'un coup. Elle doit passer avant tout travail de saisie.

**Files:**
- Modify: `src/app/api/inventory/sync/route.ts` (bloc « 5. Préparer et batch upsert des variantes », autour de la ligne 178)
- Modify: `src/config/version.ts`

**Interfaces:**
- Consumes : `product_variants.weight_grams` (Task 1).
- Produces : `weight_grams` peuplé pour toute variante dont Shopify renvoie `grams > 0`.

**Le piège :** l'upsert écrit toutes les colonnes du payload. Si on met `weight_grams: 0` pour une variante sans poids Shopify, on **écrase la saisie manuelle** au prochain rafraîchissement. Il faut relire les poids existants avant l'upsert et les reconduire.

- [ ] **Step 1 : Charger les poids déjà en base avant de construire le payload**

Juste avant la boucle `for (const product of filteredProducts)` qui remplit `variantsToUpsert`, insérer :

```ts
// Poids déjà connus, indexés par (product_id, shopify_id).
// Sans ça, l'upsert écraserait un poids saisi à la main par un zéro venu de Shopify.
const existingWeights = new Map<string, number>();
{
  const productUuids = Object.values(productIdMap);
  for (let i = 0; i < productUuids.length; i += 200) {
    const chunk = productUuids.slice(i, i + 200);
    const { data: rows } = await supabase
      .from('product_variants')
      .select('product_id, shopify_id, weight_grams')
      .in('product_id', chunk)
      .not('weight_grams', 'is', null);
    for (const r of rows ?? []) {
      existingWeights.set(`${r.product_id}:${r.shopify_id}`, r.weight_grams as number);
    }
  }
}
```

- [ ] **Step 2 : Ajouter `weight_grams` au payload d'upsert**

Dans l'objet poussé dans `variantsToUpsert`, après `cost`, ajouter :

```ts
          // Shopify fait foi quand il a une valeur. Un 0 ou une absence ne doit
          // JAMAIS effacer un poids saisi dans Ivy (96 pièces à Uriel Boxer sont
          // sur des variantes supprimées de Shopify : Ivy est leur seule source).
          weight_grams:
            variant.grams && variant.grams > 0
              ? variant.grams
              : existingWeights.get(`${productId}:${variant.id.toString()}`) ?? null,
```

- [ ] **Step 3 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune sortie.

- [ ] **Step 4 : Lancer une sync et compter les poids remontés**

Démarrer `pnpm dev`, se connecter, déclencher une synchronisation depuis l'interface. Puis :

```bash
node -e "
const fs=require('fs');
const env={};for(const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)\$/);if(m)env[m[1]]=m[2].trim()}
const H={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,Prefer:'count=exact'};
(async()=>{
 for (const [label,q] of [['avec poids','weight_grams=not.is.null'],['sans poids','weight_grams=is.null']]) {
   const r=await fetch(env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/product_variants?select=id&'+q,{headers:{...H,Range:'0-0'}});
   console.log(label, r.headers.get('content-range'));
 }
})();
"
```
Expected: « avec poids » autour de **4 502**, « sans poids » autour de **408**. Un « avec poids » proche de 0 signifie que `variant.grams` n'est pas lu correctement.

- [ ] **Step 5 : Vérifier qu'une seconde sync n'écrase rien**

Poser un poids à la main sur une variante sans poids Shopify, relancer une sync, vérifier qu'il est toujours là :

```bash
node -e "
const fs=require('fs');
const env={};for(const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)\$/);if(m)env[m[1]]=m[2].trim()}
const H={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
(async()=>{
 const r=await fetch(env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/product_variants?select=id,shopify_active&weight_grams=is.null&limit=1',{headers:H});
 const [v]=await r.json();
 if(!v){console.log('aucune variante sans poids, test impossible');return}
 await fetch(env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/product_variants?id=eq.'+v.id,{method:'PATCH',headers:H,body:JSON.stringify({weight_grams:777})});
 console.log('temoin pose sur', v.id, '-> relancer une sync puis relire cette ligne');
})();
"
```
Expected: après une seconde sync, la variante témoin vaut toujours `777`. Si elle est repassée à `null`, l'étape 1 n'a pas été appliquée.

- [ ] **Step 6 : Commit**

```bash
# version.ts : 0.5.108 -> 0.5.109
git add src/app/api/inventory/sync/route.ts src/config/version.ts
git commit -m "feat(poids): la sync remonte le poids Shopify sans ecraser les saisies"
```

---

### Task 3 : L'échelle des tailles et le calcul déduit

**Files:**
- Create: `src/lib/weights/sizes.ts`
- Modify: `src/config/version.ts`

**Interfaces:**
- Produces :
  - `SIZE_LADDER: readonly string[]`
  - `normalizeSize(raw: string | null | undefined): string | null`
  - `sizeDistance(reference: string, target: string): number | null`
  - `computeWeight(referenceGrams: number, stepPct: number, distance: number): number`
  - `NO_SIZE: '—'`

- [ ] **Step 1 : Écrire le module**

```ts
/**
 * Échelle des tailles textiles : l'ordre définit les « crans » qui séparent
 * deux tailles. Un poids est mesuré sur UNE taille, les autres se déduisent.
 */
export const SIZE_LADDER = [
  'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL',
] as const;

/** Marqueur des produits qui n'ont pas de taille (mug, sticker…). */
export const NO_SIZE = '—';

const SYNONYMS: Record<string, string> = {
  '2XL': 'XXL',
  'XXXL': '3XL',
  'XXXXL': '4XL',
  'XXXXXL': '5XL',
  'TU': NO_SIZE,
  'UNIQUE': NO_SIZE,
  'TAILLE UNIQUE': NO_SIZE,
};

/**
 * Ramène une valeur d'option brute à une taille de l'échelle.
 * Retourne null si la valeur n'est pas une taille reconnue — la variante
 * bascule alors dans la liste d'exceptions.
 */
export function normalizeSize(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const up = raw.trim().toUpperCase();
  if (!up) return null;
  const mapped = SYNONYMS[up] ?? up;
  if (mapped === NO_SIZE) return NO_SIZE;
  return (SIZE_LADDER as readonly string[]).includes(mapped) ? mapped : null;
}

/**
 * Nombre de crans entre deux tailles. Négatif vers les petites tailles.
 * Retourne null si l'une des deux n'est pas sur l'échelle.
 */
export function sizeDistance(reference: string, target: string): number | null {
  const a = (SIZE_LADDER as readonly string[]).indexOf(reference);
  const b = (SIZE_LADDER as readonly string[]).indexOf(target);
  if (a === -1 || b === -1) return null;
  return b - a;
}

/**
 * Poids déduit, variation CUMULÉE d'un cran à l'autre :
 *   poids(d) = reference × (1 + step/100) ^ d
 * L'écart en grammes grandit avec la taille, ce qui colle au textile réel.
 */
export function computeWeight(referenceGrams: number, stepPct: number, distance: number): number {
  return Math.round(referenceGrams * Math.pow(1 + stepPct / 100, distance));
}
```

- [ ] **Step 2 : Vérifier le calcul contre l'exemple validé de la spec**

Run:
```bash
npx tsx -e "
import { computeWeight, sizeDistance, normalizeSize } from './src/lib/weights/sizes';
const ref = 250, step = 8;
for (const s of ['XS','S','M','L','XL','XXL','3XL']) {
  const d = sizeDistance('M', s)!;
  console.log(s.padEnd(4), computeWeight(ref, step, d));
}
console.log('2XL ->', normalizeSize('2XL'));
console.log('bidon ->', normalizeSize('Bidon'));
"
```
Expected, exactement :
```
XS   214
S    231
M    250
L    270
XL   292
XXL  315
3XL  340
2XL -> XXL
bidon -> null
```

> Ces valeurs font foi : descendre d'un cran **divise** par `1 + step/100`, ça ne
> multiplie pas par `1 - step/100`. Les deux conventions divergent (231 contre 230 en S,
> 214 contre 212 en XS). L'exposant négatif est la bonne, elle rend la courbe symétrique :
> monter puis redescendre d'un cran retombe exactement sur le poids de départ.

Si `npx tsx` n'est pas disponible, remplacer par un fichier temporaire dans le scratchpad compilé via `npx tsc`.

- [ ] **Step 3 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune sortie.

- [ ] **Step 4 : Commit**

```bash
# version.ts : 0.5.109 -> 0.5.110
git add src/lib/weights/sizes.ts src/config/version.ts
git commit -m "feat(poids): echelle des tailles et calcul du poids deduit"
```

---

### Task 4 : Pousser un poids vers Shopify

**Files:**
- Create: `src/lib/shopify/weight.ts`
- Modify: `src/config/version.ts`

**Interfaces:**
- Produces : `pushVariantWeight(args): Promise<PushWeightResult>`

```ts
export interface PushWeightResult {
  pushed: boolean;          // true = Shopify a accepté
  skipped: boolean;         // true = variante locale, pas d'appel tenté
  error?: string;
}
```

- [ ] **Step 1 : Écrire le module**

```ts
/**
 * Écriture du poids d'une variante vers Shopify.
 *
 * Le poids ne vit PAS sur la variante mais sur son inventory item
 * (`InventoryItem.measurement.weight`). On passe par la mutation GraphQL
 * `inventoryItemUpdate` (API 2026-01) et non par la REST `variants.json` :
 * la famille REST produits/variantes est en voie de dépréciation, et on
 * s'est déjà fait avoir avec `inventory_levels/adjust.json`.
 *
 * Scope requis : write_inventory (déjà accordé — les ajustements de stock
 * du HUB de stand l'utilisent).
 */
export interface PushWeightResult {
  pushed: boolean;
  skipped: boolean;
  error?: string;
}

const MUTATION = `
  mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      userErrors { field message }
      inventoryItem { id }
    }
  }
`;

export async function pushVariantWeight(args: {
  shopifyUrl: string;
  shopifyToken: string;
  inventoryItemId: string | null;
  shopifyActive: boolean | null;
  grams: number;
}): Promise<PushWeightResult> {
  const { shopifyUrl, shopifyToken, inventoryItemId, shopifyActive, grams } = args;

  // Variante purement locale, ou supprimée de Shopify : l'inventory_item_id
  // stocké est mort, l'appel échouerait avec « inventory item could not be found ».
  if (!inventoryItemId || shopifyActive === false) {
    return { pushed: false, skipped: true };
  }

  const variables = {
    id: `gid://shopify/InventoryItem/${inventoryItemId}`,
    input: { measurement: { weight: { unit: 'GRAMS', value: grams } } },
  };

  let response: Response;
  try {
    response = await fetch(`https://${shopifyUrl}/admin/api/2026-01/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': shopifyToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: MUTATION, variables }),
    });
  } catch (e) {
    return { pushed: false, skipped: false, error: 'Shopify injoignable' };
  }

  const data = await response.json().catch(() => null);

  if (!response.ok || data?.errors) {
    console.error('[poids] Shopify GraphQL failed:', {
      status: response.status,
      errors: data?.errors,
      inventoryItemId,
    });
    return { pushed: false, skipped: false, error: `Shopify HTTP ${response.status}` };
  }

  const userErrors = data?.data?.inventoryItemUpdate?.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      pushed: false,
      skipped: false,
      error: userErrors.map((e: { message: string }) => e.message).join(' / '),
    };
  }

  return { pushed: true, skipped: false };
}
```

- [ ] **Step 2 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune sortie.

- [ ] **Step 3 : Commit**

```bash
# version.ts : 0.5.110 -> 0.5.111
git add src/lib/shopify/weight.ts src/config/version.ts
git commit -m "feat(poids): pousse le poids vers Shopify via inventoryItemUpdate"
```

---

### Task 5 : API des règles de poids

**Files:**
- Create: `src/app/api/settings/weight-rules/route.ts`
- Modify: `src/config/version.ts`

**Interfaces:**
- Produces :
  - `GET /api/settings/weight-rules?shopId=<uuid>` → `{ rules: WeightTypeRule[], productTypes: string[], sizesByType: Record<string, string[]> }`
  - `PUT /api/settings/weight-rules` body `{ shopId, productType, referenceSize, referenceGrams, stepPct }` → `{ rule }`
  - `DELETE /api/settings/weight-rules?shopId=<uuid>&productType=<t>` → `{ ok: true }`

```ts
export interface WeightTypeRule {
  id: string;
  product_type: string;
  reference_size: string;
  reference_grams: number;
  step_pct: number;
}
```

- [ ] **Step 1 : Écrire la route**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizeSize, NO_SIZE } from '@/lib/weights/sizes';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** Nom d'option considéré comme portant la taille. */
function isSizeOption(name: string | null): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  return n === 'taille' || n === 'size';
}

export async function GET(request: NextRequest) {
  const shopId = request.nextUrl.searchParams.get('shopId');
  if (!shopId) return NextResponse.json({ error: 'shopId requis' }, { status: 400 });

  const { data: rules, error } = await supabase
    .from('weight_type_rules')
    .select('id, product_type, reference_size, reference_grams, step_pct')
    .eq('shop_id', shopId)
    .order('product_type');

  if (error) {
    console.error('GET /api/settings/weight-rules:', error);
    return NextResponse.json({ error: 'Lecture impossible' }, { status: 500 });
  }

  // Types de produits et tailles réellement présents, pour dessiner la grille.
  // PostgREST plafonne à 1000 lignes → pagination avec un order explicite.
  const productTypes = new Set<string>();
  const sizesByType = new Map<string, Set<string>>();

  for (let from = 0; ; from += 1000) {
    const { data: rows } = await supabase
      .from('products')
      .select('product_type, option1Name:option1_name, product_variants(option1, option2, option3)')
      .eq('shop_id', shopId)
      .order('id')
      .range(from, from + 999);
    if (!rows || rows.length === 0) break;
    for (const p of rows as unknown as ProductRow[]) {
      const type = p.product_type || '(sans type)';
      productTypes.add(type);
      if (!sizesByType.has(type)) sizesByType.set(type, new Set());
      for (const v of p.product_variants ?? []) {
        for (const raw of [v.option1, v.option2, v.option3]) {
          const s = normalizeSize(raw);
          if (s && s !== NO_SIZE) sizesByType.get(type)!.add(s);
        }
      }
    }
    if (rows.length < 1000) break;
  }

  return NextResponse.json({
    rules: rules ?? [],
    productTypes: [...productTypes].sort(),
    sizesByType: Object.fromEntries(
      [...sizesByType.entries()].map(([k, v]) => [k, [...v]]),
    ),
  });
}

interface ProductRow {
  product_type: string | null;
  product_variants: { option1: string | null; option2: string | null; option3: string | null }[];
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { shopId, productType, referenceSize, referenceGrams, stepPct } = body as {
    shopId?: string;
    productType?: string;
    referenceSize?: string;
    referenceGrams?: number;
    stepPct?: number;
  };

  if (!shopId || !productType || !referenceSize || !referenceGrams) {
    return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
  }
  if (referenceGrams <= 0) {
    return NextResponse.json({ error: 'Le poids de référence doit être positif' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('weight_type_rules')
    .upsert(
      {
        shop_id: shopId,
        product_type: productType,
        reference_size: referenceSize,
        reference_grams: Math.round(referenceGrams),
        step_pct: stepPct ?? 8,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_id,product_type' },
    )
    .select('id, product_type, reference_size, reference_grams, step_pct')
    .single();

  if (error) {
    console.error('PUT /api/settings/weight-rules:', error);
    return NextResponse.json({ error: 'Enregistrement impossible' }, { status: 500 });
  }

  return NextResponse.json({ rule: data });
}

export async function DELETE(request: NextRequest) {
  const shopId = request.nextUrl.searchParams.get('shopId');
  const productType = request.nextUrl.searchParams.get('productType');
  if (!shopId || !productType) {
    return NextResponse.json({ error: 'shopId et productType requis' }, { status: 400 });
  }

  const { error } = await supabase
    .from('weight_type_rules')
    .delete()
    .eq('shop_id', shopId)
    .eq('product_type', productType);

  if (error) {
    console.error('DELETE /api/settings/weight-rules:', error);
    return NextResponse.json({ error: 'Suppression impossible' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

> **Attention à vérifier pendant l'implémentation :** le nom réel des colonnes d'option
> sur `products` (`option1_name` ou `option1Name`). Le consulter dans
> `graphify-out/graph.json` ou via un `select=*&limit=1` avant d'écrire la requête, et
> ajuster. Ne jamais deviner un nom de colonne.

- [ ] **Step 2 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune sortie.

- [ ] **Step 3 : Vérifier la lecture contre les vraies données**

`pnpm dev` puis, avec un `shopId` valide récupéré en base :

Run: `curl -s "http://localhost:3000/api/settings/weight-rules?shopId=<UUID>" | head -c 800`
Expected: `rules` vide au premier appel, `productTypes` contenant au moins `Le Confort`, `Le Moelleux`, `Le Zippé`, et `sizesByType["Le Zippé"]` contenant des tailles de l'échelle.

- [ ] **Step 4 : Vérifier l'écriture**

Run:
```bash
curl -s -X PUT http://localhost:3000/api/settings/weight-rules \
  -H 'Content-Type: application/json' \
  -d '{"shopId":"<UUID>","productType":"Le Confort","referenceSize":"M","referenceGrams":250,"stepPct":8}'
```
Expected: `{"rule":{...,"reference_grams":250,...}}`. Rappeler le GET : la règle apparaît.

- [ ] **Step 5 : Commit**

```bash
# version.ts : 0.5.111 -> 0.5.112
git add src/app/api/settings/weight-rules/route.ts src/config/version.ts
git commit -m "feat(poids): API des regles de poids par type"
```

---

### Task 6 : Appliquer une règle aux variantes

**Files:**
- Create: `src/app/api/settings/weight-rules/apply/route.ts`
- Modify: `src/config/version.ts`

**Interfaces:**
- Consumes : `computeWeight`, `sizeDistance`, `normalizeSize`, `NO_SIZE` (Task 3) ; `pushVariantWeight` (Task 4) ; `weight_type_rules` (Task 5).
- Produces : `POST /api/settings/weight-rules/apply` body `{ shopId, productType?, overwrite? }` → `ApplyReport`

```ts
export interface ApplyReport {
  filled: number;        // variantes dont weight_grams a été écrit
  pushed: number;        // dont poussées vers Shopify
  localOnly: number;     // dont gardées dans Ivy seulement
  unresolved: number;    // taille hors échelle → non traitées
  failures: { variantId: string; label: string; error: string }[];
}
```

- [ ] **Step 1 : Écrire la route**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizeSize, sizeDistance, computeWeight, NO_SIZE } from '@/lib/weights/sizes';
import { pushVariantWeight } from '@/lib/shopify/weight';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface ApplyReport {
  filled: number;
  pushed: number;
  localOnly: number;
  unresolved: number;
  failures: { variantId: string; label: string; error: string }[];
}

export async function POST(request: NextRequest) {
  const { shopId, productType, overwrite } = (await request.json()) as {
    shopId?: string;
    productType?: string;
    overwrite?: boolean;
  };

  if (!shopId) return NextResponse.json({ error: 'shopId requis' }, { status: 400 });

  const { data: shop } = await supabase
    .from('shops')
    .select('shopify_url, shopify_token')
    .eq('id', shopId)
    .single();

  let rulesQuery = supabase
    .from('weight_type_rules')
    .select('product_type, reference_size, reference_grams, step_pct')
    .eq('shop_id', shopId);
  if (productType) rulesQuery = rulesQuery.eq('product_type', productType);

  const { data: rules } = await rulesQuery;
  if (!rules || rules.length === 0) {
    return NextResponse.json({ error: 'Aucune règle à appliquer' }, { status: 400 });
  }

  const report: ApplyReport = { filled: 0, pushed: 0, localOnly: 0, unresolved: 0, failures: [] };

  for (const rule of rules) {
    // Produits de ce type, avec leurs variantes. Pagination : PostgREST
    // plafonne à 1000 lignes et un range sans order est instable.
    for (let from = 0; ; from += 200) {
      const { data: products } = await supabase
        .from('products')
        .select(
          'id, title, product_type, product_variants(id, title, option1, option2, option3, weight_grams, inventory_item_id, shopify_active)',
        )
        .eq('shop_id', shopId)
        .eq('product_type', rule.product_type)
        .order('id')
        .range(from, from + 199);

      if (!products || products.length === 0) break;

      for (const product of products as unknown as ProductWithVariants[]) {
        for (const v of product.product_variants ?? []) {
          if (!overwrite && v.weight_grams != null) continue;

          const size =
            [v.option1, v.option2, v.option3].map(normalizeSize).find(s => s !== null) ?? null;

          if (size === null) {
            report.unresolved++;
            continue;
          }

          const grams =
            size === NO_SIZE
              ? rule.reference_grams
              : (() => {
                  const d = sizeDistance(rule.reference_size, size);
                  return d === null ? null : computeWeight(rule.reference_grams, rule.step_pct, d);
                })();

          if (grams === null) {
            report.unresolved++;
            continue;
          }

          // Shopify d'abord : si l'écriture distante échoue, Ivy ne bouge pas.
          if (shop?.shopify_url && shop?.shopify_token) {
            const res = await pushVariantWeight({
              shopifyUrl: shop.shopify_url,
              shopifyToken: shop.shopify_token,
              inventoryItemId: v.inventory_item_id,
              shopifyActive: v.shopify_active,
              grams,
            });
            if (res.error) {
              report.failures.push({
                variantId: v.id,
                label: `${product.title} / ${v.title}`,
                error: res.error,
              });
              continue;
            }
            if (res.pushed) report.pushed++;
            if (res.skipped) report.localOnly++;
          } else {
            report.localOnly++;
          }

          const { error: upErr } = await supabase
            .from('product_variants')
            .update({ weight_grams: grams, updated_at: new Date().toISOString() })
            .eq('id', v.id);

          if (upErr) {
            report.failures.push({
              variantId: v.id,
              label: `${product.title} / ${v.title}`,
              error: 'Écriture Ivy impossible',
            });
            continue;
          }

          report.filled++;
        }
      }

      if (products.length < 200) break;
    }
  }

  return NextResponse.json(report);
}

interface ProductWithVariants {
  id: string;
  title: string;
  product_type: string | null;
  product_variants: {
    id: string;
    title: string;
    option1: string | null;
    option2: string | null;
    option3: string | null;
    weight_grams: number | null;
    inventory_item_id: string | null;
    shopify_active: boolean | null;
  }[];
}
```

> **Performance :** un appel Shopify par variante. Sur `Le Zippé` (804 variantes) c'est
> long. Si l'attente est insupportable à l'usage, la parade est un passage en SSE sur le
> modèle de `apply-ivy-stream` — à ne faire que si le besoin se confirme, pas d'avance.

- [ ] **Step 2 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune sortie.

- [ ] **Step 3 : Appliquer sur un type restreint et lire le compte-rendu**

Run:
```bash
curl -s -X POST http://localhost:3000/api/settings/weight-rules/apply \
  -H 'Content-Type: application/json' \
  -d '{"shopId":"<UUID>","productType":"Le Zippé"}'
```
Expected: `filled` ≈ 324 (les variantes sans poids de ce type), `pushed` proche de `filled` moins les variantes `shopify_active=false`, `failures` vide. Un `unresolved` élevé signale que la taille ne se résout pas — vérifier les noms d'options du type.

- [ ] **Step 4 : Vérifier qu'un poids existant n'a pas été écrasé**

Run: relancer la même commande.
Expected: `filled: 0` — tout est déjà rempli, rien à refaire. Avec `"overwrite": true`, `filled` remonte à l'effectif complet du type.

- [ ] **Step 5 : Commit**

```bash
# version.ts : 0.5.112 -> 0.5.113
git add src/app/api/settings/weight-rules/apply/route.ts src/config/version.ts
git commit -m "feat(poids): application d'une regle de poids aux variantes"
```

---

### Task 7 : Poids d'une variante unique

**Files:**
- Create: `src/app/api/inventory/variants/[id]/weight/route.ts`
- Modify: `src/config/version.ts`

**Interfaces:**
- Consumes : `pushVariantWeight` (Task 4).
- Produces : `PATCH /api/inventory/variants/[id]/weight` body `{ shopId, grams }` → `{ ok, pushed, skipped, error? }`

- [ ] **Step 1 : Écrire la route**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { pushVariantWeight } from '@/lib/shopify/weight';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const { shopId, grams } = (await request.json()) as { shopId?: string; grams?: number };

  if (!shopId || typeof grams !== 'number') {
    return NextResponse.json({ error: 'shopId et grams requis' }, { status: 400 });
  }
  if (grams <= 0) {
    return NextResponse.json({ error: 'Le poids doit être positif' }, { status: 400 });
  }

  const { data: variant } = await supabase
    .from('product_variants')
    .select('id, inventory_item_id, shopify_active')
    .eq('id', id)
    .single();

  if (!variant) return NextResponse.json({ error: 'Variante introuvable' }, { status: 404 });

  const { data: shop } = await supabase
    .from('shops')
    .select('shopify_url, shopify_token')
    .eq('id', shopId)
    .single();

  if (!shop) return NextResponse.json({ error: 'Boutique introuvable' }, { status: 404 });

  // Shopify d'abord : en cas d'échec, Ivy ne bouge pas et les deux restent d'accord.
  const push = await pushVariantWeight({
    shopifyUrl: shop.shopify_url,
    shopifyToken: shop.shopify_token,
    inventoryItemId: variant.inventory_item_id,
    shopifyActive: variant.shopify_active,
    grams: Math.round(grams),
  });

  if (push.error) {
    return NextResponse.json(
      { ok: false, pushed: false, skipped: false, error: push.error },
      { status: 502 },
    );
  }

  const { error } = await supabase
    .from('product_variants')
    .update({ weight_grams: Math.round(grams), updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error('PATCH weight:', error);
    return NextResponse.json({ ok: false, error: 'Écriture Ivy impossible' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, pushed: push.pushed, skipped: push.skipped });
}
```

- [ ] **Step 2 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune sortie.

- [ ] **Step 3 : Tester sur une variante Shopify active**

Run:
```bash
curl -s -X PATCH http://localhost:3000/api/inventory/variants/<VARIANT_UUID>/weight \
  -H 'Content-Type: application/json' -d '{"shopId":"<UUID>","grams":260}'
```
Expected: `{"ok":true,"pushed":true,"skipped":false}`. Vérifier dans l'admin Shopify que le poids de cette variante affiche 260 g.

- [ ] **Step 4 : Tester sur une variante `shopify_active = false`**

Récupérer un `id` de variante avec `shopify_active = false` (il y en a 68 lignes en stock à Uriel Boxer), puis relancer la commande.
Expected: `{"ok":true,"pushed":false,"skipped":true}` — écrit dans Ivy, aucun appel Shopify tenté.

- [ ] **Step 5 : Commit**

```bash
# version.ts : 0.5.113 -> 0.5.114
git add "src/app/api/inventory/variants/[id]/weight/route.ts" src/config/version.ts
git commit -m "feat(poids): saisie du poids d'une variante unique"
```

---

### Task 8 : L'écran `/parametres/poids`

**Files:**
- Create: `src/app/parametres/poids/page.tsx`
- Modify: `src/layout/ParametresLayout.tsx` (tableau `menuCategories`, après l'entrée « Conteneurs »)
- Modify: `src/config/version.ts`

**Interfaces:**
- Consumes : les trois routes API (Tasks 5, 6, 7) et `src/lib/weights/sizes.ts` (Task 3).

- [ ] **Step 1 : Ajouter l'entrée de menu**

Dans `src/layout/ParametresLayout.tsx`, importer `IconWeight` depuis `@tabler/icons-react` et ajouter, après l'objet `{ href: '/parametres/conteneurs', ... }` :

```ts
        {
          href: '/parametres/poids',
          label: 'Poids',
          icon: IconWeight,
        },
```

- [ ] **Step 2 : Écrire la page**

Composition attendue, en suivant le patron de `src/app/parametres/couleurs/page.tsx` (`'use client'`, `useShop()` depuis `@/context/ShopContext`, styles depuis `../parametres.module.scss`, notifications Mantine) :

- Chargement : `GET /api/settings/weight-rules?shopId=…` au montage et à chaque changement de shop.
- **La grille** : une ligne par `productType`. Colonnes = `SIZE_LADDER` restreint aux tailles présentes pour ce type (`sizesByType`). Chaque ligne porte :
  - un `NumberInput` « Poids de référence » (grammes) et un `Select` « Taille pesée » alimenté par les tailles du type ;
  - un `NumberInput` « Variation » avec `suffix=" %"`, défaut `8` ;
  - les poids déduits affichés par `computeWeight(ref, step, sizeDistance(refSize, size))`, en texte grisé, la case de référence en gras avec une puce « pesée » ;
  - sur chaque case non-référence, un bouton `Faire de ce poids la référence` : il ouvre un `NumberInput` pour saisir le poids mesuré à CETTE taille, puis appelle `PUT` avec `referenceSize = cette taille` et `referenceGrams = valeur saisie`. Toute la ligne se recalcule.
  - un bouton `Appliquer` par ligne → `POST /api/settings/weight-rules/apply` avec le `productType`, et une `Checkbox` « écraser les poids existants » qui pilote `overwrite`.
- **Le compte-rendu** : après application, une notification verte `X poids remplis · Y poussés vers Shopify · Z gardés en local`. Si `failures.length > 0`, une notification rouge **`autoClose: false`** listant les échecs — même discipline que le HUB de stand : un échec silencieux est pire qu'un échec bruyant.
- **La liste d'exceptions**, sous la grille : les variantes encore sans poids. Elle se charge via `GET /api/products?shopId=…` filtré côté client sur `weight_grams == null`, affiche produit / variante / taille brute, un `NumberInput` et un bouton qui appelle `PATCH /api/inventory/variants/[id]/weight`. Une variante `shopify_active === false` porte une pastille « Ivy seulement » pour expliquer pourquoi elle ne partira pas vers Shopify.

- [ ] **Step 3 : Vérifier la compilation et le build**

Run: `npx tsc --noEmit && pnpm build`
Expected: aucune erreur TypeScript, `✓ Compiled successfully`, et `/parametres/poids` listé dans la table des routes.

- [ ] **Step 4 : Vérifier à l'écran**

`pnpm dev`, aller sur `/parametres/poids`.
Attendu : l'entrée « Poids » apparaît dans le menu ; la grille liste les types de produits ; saisir 250 g en M sur `Le Confort` avec 8 % affiche la ligne `212 / 231 / 250 / 270 / 292 / 315 / 340` ; `Appliquer` remonte un compte-rendu chiffré.

- [ ] **Step 5 : Vérifier le solde final sur l'emplacement du festival**

Run: le script `check-weights-location.mjs` du scratchpad, ou son équivalent.
Expected: « Pièces SANS poids » tombé de **116 à 96 au maximum** (les 20 vestes zippées réglées par la règle). Les 96 restantes sont les variantes supprimées de Shopify — elles se règlent dans la liste d'exceptions, à la main.

- [ ] **Step 6 : Commit**

```bash
# version.ts : 0.5.114 -> 0.5.115
git add src/app/parametres/poids/page.tsx src/layout/ParametresLayout.tsx src/config/version.ts
git commit -m "feat(poids): ecran de reglage des poids par type de produit"
```

---

## Ce que ce plan ne fait pas

La déclaration douanière elle-même — tables du passage, décomposition des coûts, écran de contrôle, PDF — fait l'objet d'un **second plan**, à écrire une fois celui-ci exécuté. Il dépend de `weight_grams`, pas l'inverse.

La migration des quatre routes `apply-*` vers un module de calcul partagé est une dette identifiée, **hors périmètre ici** : elles fonctionnent, et on ne touche pas à du code qui marche à trois jours d'un festival.
