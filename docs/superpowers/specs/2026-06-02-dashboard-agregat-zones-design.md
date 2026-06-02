# Design — Agrégat « Tous les festivals » sur le Tableau de bord

> Date : 2026-06-02 · Statut : approuvé (design) · Auteur : Uriel + Claude

## Contexte

Le tableau de bord du Stand (`src/app/ivy/stand/page.tsx`) affiche aujourd'hui des
compteurs **temporels** (sorties aujourd'hui, retours aujourd'hui, cette semaine,
ce mois), scopés au **seul** emplacement courant du sélecteur global
(`LocationContext`).

Les zones d'étude (festivals) vivent sur une page séparée (`/ivy/stand/zones`),
chacune avec son propre récap calculé par `/api/pos/study-zones/stats`. Une zone
est purement une **fenêtre de dates** (`date_from` / `date_to`, table
`pos_study_zones`) ; elle ne porte pas d'emplacement — l'emplacement est un filtre
orthogonal appliqué aux `stock_movements`.

## Objectif

Ajouter au tableau de bord un bloc qui **agrège TOUTES les zones d'étude** d'un shop,
avec un filtre **multi-emplacements** (cases à cocher), affichant des compteurs
globaux **et** les classements Top Fragments / Top Produits / Top Variantes.

## Décisions produit (validées)

- **Contenu** : compteurs globaux (sorties / retours cumulés) **+** Top Fragments,
  Top Produits, Top Variantes — cumulés sur toutes les zones.
- **Filtre emplacement** : multi-select dédié à **cases à cocher**, **indépendant**
  du sélecteur global, **tous cochés par défaut**.
- **Emplacement du bloc** : sur la **même** page tableau de bord, **sous** les cartes
  temporelles existantes.

## Hors périmètre (YAGNI)

- Pas de filtre temporel sur l'agrégat.
- Pas de tableau comparatif par zone.
- Pas d'export (CSV/PDF).
- Pas d'« options par catégorie » (Couleur/Taille…) dans l'agrégat — plus lourd
  (requêtes `product_variants` supplémentaires), non demandé.

## Architecture

Approche retenue : **endpoint dédié + helper d'agrégation partagé** (vs. fusion
côté client, rejetée car re-fusionner des top-N tronqués est incorrect ; vs.
duplication de logique, rejetée car on vient de corriger le regroupement des
fragments et il ne doit exister qu'à un endroit).

### 1. Helper partagé — `src/app/api/pos/study-zones/_lib/aggregate.ts` (nouveau)

Fonction **pure**, sans I/O :

```ts
interface MovementRow {
  variant_id: string | null;
  product_title: string;
  variant_title: string | null;
  quantity: number;
  moved_on: string;
}

interface AggregateResult {
  totalItemsOut: number;
  totalItemsReturn: number;
  topProducts: Array<{ name: string; quantity: number }>;
  topVariants: Array<{ name: string; quantity: number }>;
  topNames: Array<{ fullName: string; quantity: number }>;
}

export function aggregateMovements(movements: MovementRow[]): AggregateResult
```

Contient la logique aujourd'hui inline dans `stats/route.ts` :
- totaux sorties / retours (qty < 0 / qty > 0) ;
- `topProducts` : regroupé par `product_title` exact ;
- `topVariants` : regroupé par `` `${product_title} — ${variant_title || 'Default'}` `` (slice top 20) ;
- `topNames` (« Fragments ») : regroupé par **nom de design** = partie avant le
  séparateur `|` / `—`, clé en lowercase, libellé = premier original rencontré
  (logique corrigée le 2026-06-02, commit `826df29` — surtout **pas** de préfixe de
  longueur fixe).

`stats/route.ts` est refactoré pour appeler ce helper → comportement par-zone
strictement inchangé. `topOptionsByCategory` et `movementsByDay` restent dans
`stats/route.ts` (spécifiques à la vue par-zone).

### 2. Endpoint — `src/app/api/pos/study-zones/aggregate-stats/route.ts` (nouveau)

`GET` avec params :
- `shopId` (requis) ;
- `locationIds` : liste de Shopify location IDs séparés par virgule. Vide ou absent
  ⇒ **tous** les emplacements (pas de filtre `location_id`).

Logique :
1. Charger toutes les zones du shop (`pos_study_zones` where `shop_id`).
   Si aucune zone ⇒ renvoyer un agrégat vide.
2. Calculer la fenêtre globale `from = min(date_from)`, `to = max(date_to)`.
3. Résoudre chaque `locationId` Shopify → UUID via `locations.shopify_id`
   (même logique que `stats/route.ts`). Les IDs non résolus sont ignorés.
4. **Une seule** requête `stock_movements` :
   `shop_id = …` AND `moved_on >= from` AND `moved_on <= to`
   AND (si emplacements sélectionnés) `location_id in (uuids…)`.
5. Filtrer en JS : ne garder que les mouvements dont `moved_on` tombe dans **au
   moins une** plage `[date_from, date_to]` de zone (évite le double-comptage des
   zones qui se chevauchent et exclut tout mouvement hors-festival dans la fenêtre
   globale).
6. Renvoyer `aggregateMovements(filtered)` + métadonnées :
   `{ ...aggregate, zonesCount, locationsCount }`.

Sécurité multi-tenant : filtrage systématique par `shop_id` (service_role bypass RLS).

### 3. Frontend — `src/app/ivy/stand/page.tsx`

Nouveau bloc **« Tous les festivals »** sous le `SimpleGrid` des cartes temporelles
existantes (mêmes styles `metricCard`, `table` du module SCSS du stand / des zones).

- État local `selectedLocationIds: string[]`, initialisé à **tous** les
  `locations` (du `LocationContext`) une fois chargés.
- Panneau de **cases à cocher** : une par emplacement + raccourci « Tout / Aucun ».
- `useEffect` ⇒ fetch `/api/pos/study-zones/aggregate-stats` à chaque changement de
  `selectedLocationIds` (et au chargement du shop).
- Affichage : 2 cartes compteurs (sorties / retours cumulés) + 3 tableaux Top
  Fragments / Top Produits / Top Variantes. États `loading` / vide gérés.
- Si 0 case cochée ⇒ afficher un état vide explicite (« Sélectionnez au moins un
  emplacement »), pas d'appel réseau.

## Flux de données

```
[stand/page.tsx]
   selectedLocationIds (cases) ──▶ GET /api/pos/study-zones/aggregate-stats?shopId&locationIds
                                        │
                                        ├─ charge zones (fenêtre globale)
                                        ├─ résout locations Shopify→UUID
                                        ├─ 1 requête stock_movements (fenêtre + locations)
                                        ├─ filtre JS « dans au moins une zone »
                                        └─ aggregateMovements() ──▶ JSON
   ◀── { totals, topNames, topProducts, topVariants, zonesCount, locationsCount }
```

## Gestion d'erreurs / cas limites

- Aucune zone définie ⇒ agrégat vide, message « Aucune zone d'étude ».
- 0 emplacement coché ⇒ pas d'appel, état vide.
- `locationId` Shopify non résolu en UUID ⇒ ignoré silencieusement (n'invalide pas
  la requête).
- Échec réseau ⇒ état d'erreur local au bloc, sans casser les cartes temporelles.

## Tests / vérification

Pas de framework de tests dans le projet ⇒ vérification manuelle via `pnpm dev` :
- agrégat « tous emplacements » cohérent avec la somme des récaps par-zone ;
- (re)vérifier que la vue par-zone existante est inchangée après refactor du helper ;
- cocher/décocher des emplacements met à jour les compteurs et les tops ;
- chevauchement de dates entre deux zones ne double-compte pas.
