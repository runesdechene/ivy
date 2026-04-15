# Illustrations produits — Design

**Date :** 2026-04-15
**Statut :** Brouillon de spec, en attente de plan d'implémentation

## Contexte & problème

Sur le **feuillet de production** (`/ivy/commandes/stock/[orderId]/feuillet`), l'atelier (Tanguy) imprime les articles en se basant uniquement sur le nom du produit et ses options. Il fait parfois des erreurs d'impression parce qu'il n'a pas de repère visuel sur le motif à imprimer.

Côté Shopify, chaque produit est lié via un metafield à un **métaobjet `Illustrations`** qui contient une image (source de vérité). Cette donnée existe déjà et est maintenue dans l'admin Shopify.

## Objectif

Faire apparaître l'illustration du motif à côté de chaque ligne du feuillet de production, en utilisant la source Shopify sans dupliquer les images localement.

## Approche retenue

**Stocker uniquement l'URL** de l'illustration (CDN Shopify) dans une colonne de la table `products`, peuplée par un **bouton de sync dédié** déclenchable manuellement depuis une nouvelle page de paramètres.

### Alternatives écartées

- **Mapping manuel local (image uploadée + conditions de match)** — dupliquerait le travail déjà fait côté Shopify, maintenance double.
- **Stockage image par variante** — ~1.25 GB pour une boutique typique, redondance énorme (même motif réutilisé sur N variantes/produits).
- **Fetch à la volée depuis la page feuillet** — dépendance runtime à Shopify, latence au rendu.
- **Intégration dans la sync inventaire existante** — ferait exploser le budget Netlify 26s, et les illustrations changent rarement.

## Architecture

### 1. Modèle de données

Ajout d'**une seule colonne** à la table `products` :

```sql
ALTER TABLE products ADD COLUMN illustration_url TEXT;
```

- `NULL` = pas encore synchronisé ou pas d'illustration côté Shopify.
- Pas de nouvelle table, pas d'historique dédié (le log `syncs` suffit).

### 2. Sync des illustrations

**Nouvelle route SSE chunkée** : `/api/settings/illustrations/sync-stream`

- Pattern **cursor-based** identique à `apply-stream` (price-rules, descriptions) — 50 produits par invocation Netlify.
- Accepte `shopId`, `cursor`, `offset` en query params.
- Fait une query GraphQL Shopify par page :
  - Récupère `products(first: 50, after: $cursor)` avec leurs metafields qui sont de type `metaobject_reference`.
  - Suit la référence vers le métaobjet `Illustrations`.
  - Extrait l'URL de l'image du métaobjet (champ de type `file_reference`).
- Upsert `illustration_url` sur `products` via `onConflict: shop_id,shopify_id`.
- Envoie `DONE` avec `{ nextCursor, offset, updatedCount, missingCount, errorCount }`.

**Metafield produit cible :** `namespace: custom`, `key: illustration_produit` (label "Illustration du produit"), de type `metaobject_reference` pointant vers un métaobjet `Illustrations`. Le nom du champ image dans le métaobjet reste à découvrir par introspection lors du dev (vraisemblablement `image` ou similaire).

### 3. Page de paramètres `/parametres/illustrations`

Page sobre, en lecture seule + bouton sync discret.

- **En-tête** : titre "Illustrations produits" + texte d'explication ("Source : métaobjets Shopify. Utilisé sur le feuillet de production.").
- **Filtre rapide** : toggle "Afficher uniquement les produits sans illustration".
- **Liste des produits** (grille compacte) : miniature 80×80 (ou placeholder "—"), nom, indicateur "✓ / ⚠".
- **Bouton "Resynchroniser depuis Shopify"** : en bas de page, pas en avant — c'est une opération rare.
- Streaming terminal flottant standard (via `useTerminalStream`) pour suivre le sync, exactement comme les autres bulk actions.

**Entrée dans `ParametresLayout`** : nouvelle ligne "Illustrations" avec icône `IconPhoto` de `@tabler/icons-react`.

### 4. Intégration dans le feuillet de production

**Page cible :** `/ivy/commandes/stock/[orderId]/feuillet/page.tsx`

**Enrichissement API :** modifier `/api/suppliers/orders/[orderId]` pour joindre `product_variants.shopify_id = supplier_order_items.variant_id` → `products.illustration_url`, et ajouter ce champ au retour de chaque item.

**Rendu UI :** ajouter une **colonne "Illustration" à gauche du nom produit** dans le tableau :
- Miniature **50×50**, bordure fine, radius discret.
- Clic → modal plein écran avec l'image en grand (zoom pour l'atelier).
- Si `illustration_url = NULL` → placeholder gris "—" avec tooltip "Illustration manquante".

**Placement à gauche** pour que l'œil saisisse l'image avant de lire le nom (objectif : éviter les erreurs de Tanguy).

**Performance :** les URLs sont déjà dans la réponse API, les images chargent en parallèle depuis le CDN Shopify (cache navigateur OK).

## Flux utilisateur

1. Uriel va dans `/parametres/illustrations`.
2. Clique "Resynchroniser depuis Shopify". Le terminal flottant affiche la progression par page.
3. Une fois terminé, les produits avec illustration manquante sont visibles via le filtre.
4. Tanguy ouvre `/ivy/commandes/stock/[orderId]/feuillet` → chaque ligne affiche son illustration à gauche → il imprime le bon motif.

## Points non couverts (YAGNI)

- Pas de CRUD manuel des illustrations dans Ivy (la source de vérité reste Shopify).
- Pas de cache/TTL automatique (l'utilisateur re-sync manuellement quand il sait qu'il a ajouté des motifs).
- Pas d'affichage de l'illustration sur `/impression` (vignettes-cartes) — seul `/feuillet` est concerné dans ce scope.
- Pas de versioning ou historique des illustrations.

## Fichiers impactés

**Nouveaux :**
- `supabase/migrations/038_product_illustrations.sql` — `ALTER TABLE products`.
- `src/app/api/settings/illustrations/sync-stream/route.ts` — endpoint SSE chunké.
- `src/app/parametres/illustrations/page.tsx` — page de paramètres.

**Modifiés :**
- `src/layout/ParametresLayout.tsx` — entrée de menu "Illustrations".
- `src/app/api/suppliers/orders/[orderId]/route.ts` — join illustration_url.
- `src/app/ivy/commandes/stock/[orderId]/feuillet/page.tsx` — colonne illustration + modal zoom.
- `CLAUDE.md` — mention de `products.illustration_url` dans la section DB.
