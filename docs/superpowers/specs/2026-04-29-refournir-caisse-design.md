# Refournir une caisse — Design Spec

**Date :** 2026-04-29
**Statut :** approved (auto)
**Branche :** `feat/refournir-caisse`

## Objectif

Sur la page Logistique (`/ivy/inventaire/logistique`), permettre à l'utilisateur (ou à un agent IA) de générer une suggestion de refournissement par caisse, basée sur les statistiques de mouvements de stock, et d'envoyer cette suggestion (ajustable) vers une commande de stock (`supplier_orders`) — soit en append à une `draft` existante, soit en créant une nouvelle.

## Périmètre

**In-scope :**
- Bouton "Refournir" par caisse (menu ⋯ existant dans `ContainerCard`)
- Modal Refournir avec sélecteur de fenêtre, table de variantes, steppers, barre avant/après
- 2 endpoints REST : `GET refill-suggestions` (compute pur) et `POST refill` (create-or-append)
- Math top-up à la capacité (Hamilton method) avec fallback équiprobable
- Filtre des variantes "vivantes" (actives Shopify ou locales)
- Append-or-increment sur `supplier_order_items` quand un même `variant_id` existe déjà

**Out-of-scope (post-MVP) :**
- API key / table `integrations` (couche d'auth pour agents externes)
- MCP server qui wrap les endpoints
- Endpoint global `refill-suggestions/all` toutes caisses du shop
- Endpoint `refill/preview` (dry-run)
- Calcul automatique de `unit_price` à l'ajout (laissé au flow `apply-stock-stream` existant)
- Ajout de variantes hors-périmètre de la caisse depuis la modal (si l'utilisateur en a besoin, il affecte le produit à la caisse au préalable)

## User flow

1. L'utilisateur ouvre `/ivy/inventaire/logistique` à un emplacement donné.
2. Sur une `ContainerCard`, clique le menu ⋯ → **"Refournir"** (nouvelle entrée, avant "Affecter des produits").
3. La modal "Refournir [nom de la caisse]" s'ouvre. Header :
   - Capacité actuelle (`52/70 · 74%`)
   - Sélecteur de fenêtre : `7 derniers jours / 30 derniers jours / Depuis toujours / Festival ▾`
   - Si `Festival` choisi → 2e dropdown avec les `pos_study_zones` du shop
4. Le corps affiche une table groupée par produit affecté à la caisse. Pour chaque variante "vivante" du produit :
   - Colonnes : variante (couleur · taille), `dans la caisse`, `au stock total emplacement`, `sorties dans la fenêtre`, **suggestion** (input numérique avec steppers `[− N +]`)
   - Le default de la suggestion vient du serveur (top-up à la capacité)
5. Footer sticky :
   - **Barre avant/après** (3 zones : actuel / ajouté / vide) — recalculée live à chaque changement d'input
   - Labels "Actuel 52 → Après 67 / 70" + badge orange "+12 hors capacité" si dépassement
   - Bouton primaire **"Ajouter à une commande de stock"**
6. Au clic du bouton :
   - **Si ≥1 commande `draft` existe** → un sub-step affiche un dropdown des drafts (`BATCH-0042 (8 lignes)`, etc.) + bouton "ou créer une nouvelle"
   - **Si 0** → message "Aucune commande draft, une nouvelle sera créée (BATCH-NNNN)" + bouton "Confirmer"
7. Submit → `POST /refill` → toast `+5 lignes ajoutées à BATCH-0042` avec lien profond vers `/ivy/commandes/stock/[orderId]`
8. La modal se ferme. Le cache TanStack `useContainers` + `useOrders` est invalidé (refresh des compteurs).

### Cas vide

- **Aucun produit affecté** → modal affiche "Affecte d'abord des produits à cette caisse" + bouton qui rouvre le sub-flow "Affecter des produits". Submit désactivé.
- **Aucune variante vivante** → même affichage.
- **Caisse pleine** (toutes les targets ≤ current) → modal s'ouvre normalement, suggestions = 0, note discrète "Caisse à capacité, ajuste manuellement si nécessaire".

## API

### `GET /api/inventory/containers/[id]/refill-suggestions`

Pure compute, pas d'effets de bord. Auth service-role + filtre manuel `shop_id` via la caisse.

**Query** :
- `window: '7d' | '30d' | 'all' | 'zone'` (default `'30d'`)
- `zoneId?: string` — UUID, requis si `window === 'zone'`

**Response** (200) :

```ts
{
  containerId: string;
  containerName: string;
  capacity: { max: number; current: number; pct: number };
  window: { type: 'days' | 'zone' | 'all'; label: string };
  products: Array<{
    productId: string;
    title: string;
    variants: Array<{
      variantId: string;
      title: string;            // ex: "Black · M"
      sku: string | null;
      color: string | null;
      colorHex: string | null;
      size: string | null;
      currentInBox: number;
      currentAtLocation: number;
      soldInWindow: number;
      suggestedQty: number;
    }>;
  }>;
}
```

**Erreurs** : 400 (params invalides), 404 (container introuvable ou shop différent).

### `POST /api/inventory/containers/[id]/refill`

Action — crée OU append à une commande `draft`.

**Body** :

```ts
{
  shopId: string;
  orderId?: string;
  lines: Array<{ variantId: string; quantity: number }>; // qty > 0 requis
}
```

**Logique serveur** :
1. Si `orderId` fourni :
   - Vérifier que la commande appartient au shop ET `status === 'draft'` → sinon 409
2. Si pas d'`orderId` :
   - Créer un nouveau `supplier_orders` avec `status='draft'`, `BATCH-NNNN` auto-généré (même algo que l'endpoint POST existant)
3. Pour chaque ligne :
   - Charger `product_variants` + `products` pour récupérer `product_title`, `variant_title`, `sku`
   - Si une `supplier_order_items` existe avec mêmes `order_id + variant_id` → `UPDATE quantity = quantity + line.quantity` + `updated_at = NOW()`
   - Sinon → `INSERT` avec `unit_price = 0`, `line_total = 0`
4. Recalculer `subtotal / total_ht / total_ttc` au niveau `supplier_orders` (somme des `line_total` + `balance_adjustment`)
5. Si une variante a échoué (variant_id introuvable, etc.), continuer les autres et retourner les erreurs partielles

**Response** (200) :

```ts
{
  orderId: string;
  orderNumber: string;
  linesAdded: number;
  linesIncremented: number;
  errors?: Array<{ variantId: string; reason: string }>;
}
```

**Erreurs** : 400 (lines vide, qty invalides), 404 (container ou variant introuvable), 409 (order pas draft).

## Math du top-up

### Notation

- `V` = variantes vivantes des produits affectés à la caisse `C`, cardinal `N`
- Pour `v ∈ V` :
  - `sold_v = Σ |stock_movements.quantity|` où `variant_id = v`, `location_id = locUuid(C.location)`, `moved_on ∈ window`, `quantity < 0`
  - `current_v` = qty dans la caisse (depuis `instance.variants`)
- `total_sold = Σ sold_v`

### Cas A — `total_sold > 0` (nominal)

```
target_v_raw = C.max_capacity × (sold_v / total_sold)
floor_v      = ⌊target_v_raw⌋
rem_v        = target_v_raw − floor_v
remainder    = C.max_capacity − Σ floor_v
target_v     = floor_v + (1 si v ∈ top remainder par rem_v desc, sinon 0)
suggested_v  = max(0, target_v − current_v)
```

Garantie : `Σ target_v == C.max_capacity`.

### Cas B — `total_sold == 0`

Fallback équiprobable :

```
target_v_raw = C.max_capacity / N
```

Puis Hamilton comme cas A.

### Cas C — `N == 0`

Modal affiche message d'aide. Pas de submit possible.

## Edge cases serveur

| Cas | Comportement |
|---|---|
| `stock_movements.location_id` est UUID, `inventory_levels.location_id` est Shopify ID | Endpoint résout `locations.shopify_id → id` avant le filtre `stock_movements`. `inventory_levels` reste sur Shopify ID. |
| Variant sans row dans `inventory_levels` à la location | `currentAtLocation = 0` |
| Zone festival sans aucun mouvement | `total_sold = 0` → fallback équiprobable |
| Submit avec `Σ qty == 0` | UI désactive le bouton, API renvoie 400 |
| Variant supprimé entre open et submit | API continue les autres, renvoie `errors[{variantId, reason}]` |
| Container supprimé entre open et submit | 404 |
| `orderId` fourni mais `status ≠ 'draft'` | 409 "Cette commande n'est plus modifiable" |
| Caisse déjà à capacité | Suggestions = 0, modal s'ouvre quand même avec note |

## Performance

- L'agrégation `stock_movements` se fait en **une seule** query SQL avec `GROUP BY variant_id` côté Postgres.
- `inventory_levels` chargé en bulk via `IN (variantIds)`.
- Pas de boucle N+1.

## Components

```
src/components/Logistique/
├── ContainerCard.tsx              [MODIF]   add "Refournir" Menu.Item, plumb onRefill prop
├── RefillModal.tsx                [NEW]     main modal
└── RefillFillBar.tsx              [NEW]     barre avant/après reusable

src/hooks/
└── useRefillSuggestions.ts        [NEW]     TanStack Query wrapper around GET endpoint

src/app/api/inventory/containers/[id]/
├── refill-suggestions/route.ts    [NEW]     GET handler
└── refill/route.ts                [NEW]     POST handler

src/app/ivy/inventaire/logistique/
└── page.tsx                       [MODIF]   add refilling state + modal mount
```

Pas de migration DB. Pas de changement aux hooks `useContainers`, `useContainerTypes`.

## Surface IA / future-proofing

Trois couches, MVP n'implémente que la 1 :

1. **MVP** — appels internes via cookie session Next.js (suffisant pour le UI).
2. **Post-MVP — API key** : middleware `Authorization: Bearer ivy_xxx` qui résout `shop_id` via `integrations` (table déjà créée par migration 025), puis délègue aux mêmes handlers.
3. **Post-MVP — MCP server** : Node léger qui expose `get_refill_suggestions(...)` et `submit_refill(...)` comme outils, auth via couche 2. Permet "Claude, refournis Boxer pour Yggdrasil 2026".

Endpoints possibles plus tard sans changer ceux du MVP :
- `GET /api/inventory/containers/refill-suggestions/all?shopId=X` — vue globale toutes caisses
- `POST .../refill/preview` — dry-run avec warnings sans persister

## Tests à valider après implémentation

- [ ] `GET refill-suggestions` retourne suggestions cohérentes avec un shop ayant des `stock_movements` réels
- [ ] Hamilton garantit `Σ target == max_capacity` (test sur 4 variantes / capacité 70)
- [ ] Fallback équiprobable s'active quand `total_sold = 0`
- [ ] `POST refill` sans `orderId` crée un `BATCH-NNNN`
- [ ] `POST refill` avec `orderId` valide append correctement
- [ ] Append d'un variant déjà présent incrémente la qty (pas de duplicate)
- [ ] Recalcul des totaux (`subtotal`, `total_ht`) après append
- [ ] 409 si on tente d'append à un order `in_progress`
- [ ] Modal recalcule la barre avant/après en live au tap
- [ ] Bouton submit désactivé si `Σ qty == 0`
- [ ] Toast affiche les erreurs partielles si une ligne a échoué
