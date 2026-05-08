# Transfert de stock entre emplacements — Design Spec

**Date :** 2026-05-08
**Statut :** approved (auto, brainstorming validé section par section)
**Branche :** `feat/stock-transfer`

## Objectif

Sur la fiche produit (`/ivy/inventaire/produits` → `ProductDetailView`), permettre à l'utilisateur de transférer une partie ou la totalité du stock d'un produit, par variante, depuis l'emplacement courant (`currentLocation` du `LocationContext`) vers un autre emplacement du même shop. Le transfert se synchronise avec Shopify (deux ajustements opposés) et est journalisé dans `stock_movements`.

## Périmètre

**In-scope :**
- Colonne checkbox dans le tableau `Détail des variantes` de `ProductDetailView`, couvrant variantes Shopify ET variantes locales (mêmes lignes, le tableau les contient déjà via `sortedVariants`).
- Checkbox tri-state au header de la colonne (sélectionne / désélectionne toutes les variantes affichées).
- Barre d'action contextuelle dans le header : `[Transférer N variantes →]` + `[Désélectionner]`, visible dès qu'une variante est cochée.
- Bouton "Transférer le produit" dans le header existant (à côté de "Pousser vers Shopify"), désactivé si `product.totalQuantity === 0` — sélectionne tout puis ouvre le modal.
- Nouveau composant `<TransferModal />` : dropdown destination (locations du shop sauf `currentLocation`), tableau récap variantes (nom + stock dispo + `NumberInput` qty à transférer, default = stock dispo, max = stock dispo, min = 0), bouton `[Transférer X unités vers Y]`.
- Nouvelle route `POST /api/inventory/transfer` qui orchestre les 2 ajustements Shopify + 2 upserts `inventory_levels` + 2 inserts `stock_movements` par variante.
- Garde-fou serveur : `qty_demandée <= stock_dispo_source`, sinon item en erreur sans aucune écriture.
- Variantes purement locales (`inventory_item_id IS NULL`) : transfert local seulement, pas d'appels Shopify.
- Mise à jour de la fiche produit après succès via `onProductUpdated` (les quantités source affichées reflètent le transfert sans refresh).

**Out-of-scope (post-MVP) :**
- Multi-produits par transfert (1 produit par opération).
- Rollback Shopify en cas d'échec partiel (un côté réussit, l'autre échoue).
- Migration `transfer_id` sur `stock_movements` pour audit unifié.
- Écran "Transferts récents" / annulation d'un transfert validé.
- Lock optimiste contre les races conditions multi-utilisateurs.

## User flow

1. L'utilisateur ouvre une fiche produit (ex : Le Druide) sur sa location courante.
2. Soit il coche manuellement les variantes à transférer dans le tableau, soit il clique "Transférer le produit" pour tout pré-cocher.
3. La barre d'action affiche `[Transférer N variantes →]`. Il clique.
4. Le modal s'ouvre :
   - Dropdown "Vers" listant les autres locations du shop.
   - Tableau récap : pour chaque variante cochée, sa qty dispo + un `NumberInput` éditable (default = qty dispo, max = qty dispo).
   - Footer : annuler / `Transférer X unités vers [destination]` (libellé total dynamique).
5. Il choisit la destination, ajuste les qty si besoin (mettre 0 = exclure cette variante), valide.
6. Le serveur fait, par variante : check stock → call Shopify −X source → call Shopify +X dest → upsert local source → upsert local dest → insert mouvement -X source → insert mouvement +X dest.
7. Notification Mantine : `"X unités de N variantes transférées vers [destination]"`. Échecs partiels listés si applicable.
8. La fiche produit se met à jour avec les nouvelles quantités source.

## Architecture

### Composants modifiés

- **`src/components/Inventory/ProductDetailView.tsx`** :
  - Nouvel état `selectedVariantIds: Set<string>`.
  - Nouvel état `transferModalOpened: boolean`.
  - Nouvelle colonne checkbox en première position du tableau de variantes (Mantine `Checkbox`).
  - Header de colonne : checkbox tri-state (`indeterminate` si sélection partielle).
  - Header de la fiche : nouveau bouton `[Transférer le produit]` (icône `IconArrowsExchange` ou similaire), action `selectAll + openModal`. Désactivé si `product.totalQuantity === 0`.
  - Barre d'action contextuelle dans le header (juste au-dessus / à côté de "Sauvegarder") affichée conditionnellement quand `selectedVariantIds.size > 0` : `[Transférer N variantes →]` + `[Désélectionner]`.
  - Callback `handleTransferSuccess(updatedSourceQuantities)` qui ajuste les quantités côté front via `onProductUpdated`.

### Composants nouveaux

- **`src/components/Inventory/TransferModal.tsx`** :
  - Props : `{ opened, onClose, product, variantIds: string[], shopId, sourceLocationId, sourceLocationName, onSuccess }`.
  - Fetch les locations du shop via `/api/locations` (réutilise l'endpoint existant utilisé par `LocationContext`), filtre out `sourceLocationId`.
  - État local : `destLocationId`, `quantities: Record<string, number>` (default = qty dispo de chaque variante).
  - Tableau des variantes sélectionnées avec input qty (clamp `[0, dispo]`).
  - Bouton de validation libellé `Transférer ${total} unité(s) vers ${destName}`. Disabled si `total === 0` ou pas de destination choisie ou loading.
  - Handler `handleSubmit` : POST `/api/inventory/transfer`, gère success/erreurs, callback `onSuccess` avec les variantes effectivement transférées.

### Backend

- **`src/app/api/inventory/transfer/route.ts`** (nouveau) :
  - Lit `{ shopId, sourceLocationId, destLocationId, items: Array<{ variantId, quantity, productTitle, variantTitle? }> }`.
  - Validation : `shopId`, `sourceLocationId`, `destLocationId`, `items.length > 0`, `sourceLocationId !== destLocationId`, chaque `quantity > 0`.
  - Pré-résolution :
    - `sourceLocationUuid` et `destLocationUuid` via `locations.shopify_id`.
    - Récupération `shop.shopify_url` + `shop.shopify_token`.
  - Boucle par item :
    1. Résoudre `variantId` → UUID (helper `resolveVariantId` à factoriser ou dupliquer depuis `/api/pos/stock/adjust/route.ts`).
    2. Fetch `variant.inventory_item_id`, `inventory_levels` source pour cette variante.
    3. **Garde-fou** : si `quantity > Math.max(0, sourceLevel.quantity ?? 0)` → push erreur, continue.
    4. Si `inventory_item_id` non null : 2 appels Shopify (`inventory_levels/adjust.json` avec `available_adjustment: -quantity` au source, puis `+quantity` au dest). Si l'un échoue → push erreur, ne rien écrire en local pour cet item.
    5. Upsert `inventory_levels` source (qty − transferQty) et dest (qty_existante + transferQty).
    6. Insert 2 mouvements dans `stock_movements` (− au source, + au dest), via la même logique d'agrégation par jour que `/api/pos/stock/adjust` (upsert si une ligne existe déjà pour `(shop_id, variant_id, location_id, moved_on)`).
  - Réponse : `{ success, message, results: [{variantId, success, error?}] }`.

### Schéma DB

Aucune migration. On utilise les tables existantes :
- `inventory_levels` (`location_id` TEXT = Shopify ID)
- `stock_movements` (`location_id` UUID FK → `locations(id)`)
- `locations` (lookup Shopify ID ↔ UUID)
- `product_variants` (`inventory_item_id`, `shopify_id`)

## Edge cases

| Cas | Comportement |
|---|---|
| Variante locale (`inventory_item_id IS NULL`) | Skip Shopify, juste les upserts `inventory_levels` + inserts `stock_movements`. |
| `qty_demandée > stock_dispo` | Erreur côté serveur, item en échec, aucun changement pour cet item. UI : `NumberInput max=dispo` empêche déjà le cas, mais double-check. |
| Échec partiel Shopify | Item en erreur dans `results`, pas d'écriture locale (rollback de l'écriture mais pas de Shopify). Autres items continuent. |
| `sourceLocationId === destLocationId` | HTTP 400 côté serveur. Côté UI : dropdown exclut déjà la source. |
| `quantity <= 0` | Items à 0 filtrés côté front avant envoi. Garde-fou serveur si reçu : erreur item. |
| Variante absente de `inventory_levels` au dest | Upsert crée la ligne avec qty = transferQty. Comportement standard et désiré. |
| `stock_movements` agrégation | Si une variante a déjà bougé aujourd'hui à la même location, on additionne au lieu d'insérer (cf. `/api/pos/stock/adjust`). |
| Race condition multi-user | Pas de lock. `inventory_levels.quantity` peut théoriquement passer en dessous de 0 ; on clampe en lecture (gotcha existant). |
| `product.totalQuantity === 0` | Bouton "Transférer le produit" désactivé. Checkboxes individuelles toujours utilisables (on peut cocher une variante à 0, mais le modal aura qty=0 → submit disabled). |

## Validation manuelle

Pas de framework de tests dans Ivy. Vérification via dev server + Supabase + Shopify admin :

1. **Golden path** : ouvrir un produit, cocher 3 variantes, "Transférer 3 variantes →", choisir destination, valider → vérifier Shopify admin (stock à jour aux 2 endroits) + `inventory_levels` + `stock_movements` (2 lignes par variante).
2. **Bouton produit** : "Transférer le produit" → toutes variantes pré-cochées → valider.
3. **Édition qty** : transférer 5/10 → source = 5, dest = +5.
4. **Garde-fou** : forcer `quantity > dispo` (DevTools) → message d'erreur clair, aucun changement.
5. **Variante locale** : transférer une variante `shopifyActive=false` → pas d'appel Shopify, écritures locales OK.
6. **Variante absente au dest** : transférer vers une location vierge pour cette variante → ligne créée.
7. **UI fresh** : après succès, fiche produit reflète les nouvelles quantités source sans refresh manuel.
8. **Erreur réseau Shopify** : couper le réseau au milieu (DevTools throttle) → erreur affichée, pas de désync local.

## Notes d'implémentation

- **Réutiliser `resolveVariantId`** depuis `/api/pos/stock/adjust/route.ts` — soit factoriser dans `src/lib/supabase/resolve.ts`, soit dupliquer (préférence : factoriser, c'est utilisé 2 fois maintenant).
- **`LocationContext`** fournit déjà `currentLocation.id` (Shopify TEXT) — c'est la source.
- **API locations** : `/api/locations?shopId=...` retourne la liste des locations du shop (réutilisée par `LocationContext`).
- **Bouton header** : faire attention au layout — le header de `ProductDetailView` contient déjà 5 boutons (Importer, Pousser, Archiver, Remettre à zéro, Sauvegarder). On en ajoute un sixième. Si trop chargé, regrouper "Pousser" + "Transférer" dans un menu `⋯`. À voir au moment de l'implémentation.
- **Notification de succès** : couleur `moss`. Échec partiel : couleur `clay`. Échec total : `rust`.
