# Caisses & Logistique — Design Spec

**Date :** 2026-04-29
**Auteur :** Uriel + Claude (brainstorm)
**Statut :** Validé pour implémentation

## Contexte

Runes de Chêne stocke ses produits textiles dans des caisses physiques transportées dans des véhicules (ex: emplacement « Uriel (Boxer) » = un Peugeot Boxer). Aujourd'hui, aucune visibilité dans Ivy sur le remplissage de ces caisses : on ne sait pas quoi recommander ni quand.

Objectif : ajouter une vue logistique visuelle qui montre, pour l'emplacement courant, le remplissage de chaque caisse selon le stock réel des produits qui y sont affectés.

## Vocabulaire

- **Type de conteneur** (`container_type`) : modèle global d'une caisse (ex: « Caisse Tshirt classique » — capacité 70, ratio carré). Défini une fois, réutilisable.
- **Instance de conteneur** (`container_instance`) : une caisse physique déployée dans un emplacement précis. Plusieurs instances d'un même type peuvent coexister dans un emplacement.
- **Affectation** : produits Shopify rangés dans une instance (1+ motifs par caisse, sans maximum).

## Hypothèse de remplissage

Pour une instance avec capacité max `C` et produits affectés `P1, P2, ...` à l'emplacement `L` :

```
remplissage_units = Σ inventory_levels.available pour toutes variantes de Pi à L
remplissage_pct   = remplissage_units / C
```

Toutes variantes (couleurs/tailles) des produits affectés sont sommées. La capacité est en unités, pas en variantes distinctes.

## Modèle de données (Supabase)

### `container_types`
| col | type | notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `shop_id` | uuid FK shops | RLS |
| `name` | text | ex: « Caisse Tshirt classique » |
| `max_capacity` | int | unités |
| `empty_weight_g` | int nullable | grammes, poids à vide |
| `ratio_w` | smallint default 1 | proportion visuelle largeur |
| `ratio_h` | smallint default 1 | proportion visuelle hauteur |
| `created_at` | timestamptz default now() | |

### `container_instances`
| col | type | notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `shop_id` | uuid FK shops | RLS |
| `container_type_id` | uuid FK container_types ON DELETE RESTRICT | |
| `location_id` | text | Shopify location id (string), aligné avec `inventory_levels.location_id` (cf. cerebrum.md) |
| `position` | int default 0 | ordre d'affichage |
| `created_at` | timestamptz default now() | |

### `container_instance_products`
| col | type | notes |
| --- | --- | --- |
| `container_instance_id` | uuid FK ON DELETE CASCADE | |
| `product_id` | uuid FK products ON DELETE CASCADE | |
| PK composite | (instance_id, product_id) | |

RLS : `user_has_shop_access(shop_id)` sur les deux premières tables ; héritage via instance pour la table M2M.

### Migration (numérotation suivante : `041`)

`supabase/migrations/041_containers.sql` — création des 3 tables, FK, RLS.

## API

Toutes routes sous `/api/inventory/containers/...`, conventions existantes (Server Actions ou route handlers).

### Types de conteneurs (globaux)
- `GET    /api/inventory/container-types?shopId=X` → liste
- `POST   /api/inventory/container-types` → body `{ name, max_capacity, empty_weight_g?, ratio_w?, ratio_h? }`
- `PUT    /api/inventory/container-types/:id` → mise à jour
- `DELETE /api/inventory/container-types/:id` → 409 si instances existantes

### Instances (par emplacement)
- `GET    /api/inventory/containers?locationId=X` →
  ```ts
  {
    instances: Array<{
      id, type: { id, name, max_capacity, empty_weight_g, ratio_w, ratio_h },
      products: Array<{ id, title, illustration_url }>,
      fill: { units: number, pct: number, weight_g: number | null },
      variants: Array<{ id, title, color: string, qty: number }> // pour visu Tetris
    }>
  }
  ```
- `POST   /api/inventory/containers` → body `{ container_type_id, location_id }`
- `DELETE /api/inventory/containers/:id`
- `PUT    /api/inventory/containers/:id/products` → body `{ product_ids: uuid[] }` (remplace l'ensemble)

Le calcul `fill.units` se fait côté API : partir de `products` affectés → embed `product_variants → inventory_levels` filtré par `location_id` (pattern stats existant, cf. `/api/inventory/stats/route.ts`). **Pas** de query directe sur `inventory_levels` (limite PostgREST 1000 rows, cf. cerebrum.md).

`fill.weight_g` = `empty_weight_g + Σ qty × variant.weight_g` si `product_variants.weight_g` existe ; sinon `null`. **À vérifier en implémentation** : présence de la colonne `weight_g` (ou équivalent) sur `product_variants`. Si absente, soit l'ajouter via migration en récupérant le poids depuis Shopify (`InventoryItem.measurement.weight`), soit afficher uniquement le `empty_weight_g`.

## UI

### `/parametres/conteneurs` — CRUD types globaux

Nouvelle page Paramètres (sidebar `ParametresLayout`). Liste + modal/inline edit :
- Nom (text)
- Capacité max (number)
- Poids à vide (g, optionnel)
- Ratio visuel : 2 inputs `W × H` (ex: 1×1 carré, 2×1 large, 1×2 haut), avec preview rectangle proportionnel à côté
- Bouton « Supprimer » désactivé si type utilisé par ≥ 1 instance

Convention page : Atelier boréal tokens, typographie via `_typography.scss`.

### `/ivy/inventaire/logistique` — vue Tetris

Nouvelle entrée dans la sidebar `IvyLayout` sous Inventaire (au-dessus ou sous « Statistiques »).

**Layout :**
- Header : `LocationSelector` (emplacement courant) + nom emplacement
- Toolbar : bouton « + Conteneur » → modal :
  - Onglet 1 : choix d'un type existant (liste)
  - Onglet 2 : création rapide d'un nouveau type (mêmes champs que `/parametres/conteneurs`)
  - Validation : crée l'instance pour `currentLocation.id`
- Sidebar latérale (sticky) : compteur « X caisses débloquées » groupé par type sur cet emplacement
- Zone principale : grille flex-wrap des caisses

**Rendu d'une caisse :**
- Rectangle dimensionné par `ratio_w × ratio_h` × unité de base (~140px)
- Fond clair (cream-soft Atelier boréal)
- Border-radius léger, ombre douce
- **Remplissage Tetris** :
  - Pour chaque variante des produits affectés (où `qty > 0`) : un bloc absolument positionné, aire ∝ `qty / max_capacity`, couleur = `color-transformer` (FR → hex via Supabase color rules), packing simple (rangées du bas vers le haut, layout flex-wrap interne)
  - Espace vide en haut représente la capacité non utilisée
- Badge **météo** top-left : ☀ (≥70%), ☁ (40-69%), ⛈ (<40%) — emoji ou icône Tabler (`IconSun`, `IconCloud`, `IconCloudStorm`)
- Badge top-right : `42%` + `1.2 kg` (ou seulement `42%` si poids indisponible)
- Footer caisse : noms des produits affectés (ou « Aucun » si vide), liens vers fiche produit
- Hover/click variante → tooltip `Skjaldmö / Mocha / M — 12 unités`
- Click caisse (zone neutre) → modal **affectation produits** : multi-select des produits du shop, recherche, validation → appelle `PUT /containers/:id/products`
- Bouton « ⋯ » → menu : retirer la caisse (`DELETE`)

**Caisse sans produits affectés** : rendu « vide » (Tetris vide, badge ⛈, message « Affecter des produits »).

### Couleurs des variantes

Réutiliser `src/utils/color-transformer.ts` + `src/utils/variants.ts` pour mapper le nom de couleur (FR sur le variant) → hex CSS via `color_rules` Supabase. Fallback gris neutre si non mappé.

## Hors scope V1

- Suggestion automatique de quantités à produire (« produire 28 Skjaldmö pour remplir »)
- Réservations / mouvements de caisses entre emplacements
- Historique des affectations
- Multi-affectation (1 variante répartie sur 2 caisses) — V1 suppose stock entier dans la caisse affectée à son produit
- Edge case : un produit affecté à 2 instances dans le même emplacement (V1 : stock compté double, on documente simplement et on évitera côté UI ; V2 pourrait introduire une règle de partage)

## Risques / points d'attention

1. **Colonne weight sur `product_variants`** : à vérifier ; si absente, dégrader proprement (afficher seulement `empty_weight_g`).
2. **Performance** : sur emplacements avec beaucoup de caisses + produits, le calcul de remplissage peut faire plusieurs queries ; un seul query top-down depuis `products` avec embed est nécessaire (cf. cerebrum).
3. **`location_id` text vs uuid** : aligner sur `inventory_levels.location_id` qui est le Shopify location id (string). NE PAS utiliser `locations.id` (uuid).
4. **Tetris packing** : V1 simple (flex-wrap proportionnel), pas de vrai bin-packing — l'objectif est visuel pas exact.
5. **Suppression d'un type** : bloquée si instances existent (FK `RESTRICT`).

## Tests manuels (golden path)

1. Créer un type « Caisse Tshirt » (70 / 350g / 1×1) dans `/parametres/conteneurs`.
2. Aller sur `/ivy/inventaire/logistique`, sélectionner emplacement « Uriel (Boxer) ».
3. Ajouter 1 instance de « Caisse Tshirt ».
4. Cliquer la caisse → affecter le produit « Skjaldmö ».
5. Vérifier que le remplissage matche la somme des `inventory_levels.available` des variantes Skjaldmö à Uriel (Boxer).
6. Vérifier les couleurs des blocs Tetris (Mocha = brun, French Navy = bleu, etc.).
7. Vérifier badges météo selon %.
8. Changer d'emplacement → la grille change.
