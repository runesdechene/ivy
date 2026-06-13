# Caisses — Séparation des motifs par compartiment

> Design validé le 2026-06-14. Feature logistique.

## Problème

Le rendu "Tetris" d'une caisse répartit les variantes sur les compartiments
(`container_types.columns`, 1-8) en **équilibrant par quantité** : un même motif
peut être coupé entre deux colonnes, et deux motifs peuvent se mélanger dans une
colonne. On veut pouvoir **séparer les motifs** : un motif (= un produit) par
compartiment, et que ce soit le comportement **par défaut**.

Un "motif" = un produit (`product_id`, affiché via son illustration).

## Décisions

- **Réglage** : booléen `separate_motifs` sur le **type de caisse**, `DEFAULT true`.
  Pas de surcharge par instance (YAGNI). Pas d'édition de type existant pour l'instant
  (choix à la création ; `useUpdateContainerType` existe si on veut l'ajouter plus tard).
- **Débordement** (choix utilisateur "regrouper sans couper") :
  - motifs = colonnes → 1 motif par colonne.
  - motifs > colonnes → packer des motifs **entiers**, équilibré par quantité,
    **jamais un motif coupé** (plusieurs motifs entiers peuvent partager une colonne).
  - motifs < colonnes → un motif s'étale sur plusieurs colonnes pour remplir
    (pas de colonne vide ; couper un *même* motif est OK).
  - Tri secondaire dans une colonne : taille/couleur selon le `sortMode` de la page.
- Purement **visuel** : aucune donnée de stock touchée. Si `separate_motifs = false`,
  comportement historique strictement inchangé.

## Modèle de données

`supabase/migrations/049_container_separate_motifs.sql` :
```sql
ALTER TABLE container_types
  ADD COLUMN IF NOT EXISTS separate_motifs BOOLEAN NOT NULL DEFAULT true;
```

## Flux de données (porter le champ)

- `POST /api/inventory/container-types` : accepter + insérer `separate_motifs`.
  (`GET` fait déjà `select('*')`.)
- `GET /api/inventory/containers` : ajouter `separate_motifs` au `select` du type
  + au mapping de `InstanceResp.type`.
- Types TS : `ContainerType` (hook) et `ContainerInstance.type` (hook) reçoivent
  `separate_motifs: boolean`.

## UI

`AddContainerModal`, onglet "Créer un type" : case à cocher **"Séparer les motifs
par compartiment"** (cochée par défaut), sous "Compartiments". `separate_motifs: true`
ajouté au state `form`.

## Rendu

`ContainerCard` : nouvelle fonction `distributeByMotif(variants, cols, sortMode)`.
Sélection : si `type.separate_motifs` → `distributeByMotif`, sinon le comportement
actuel (`distributeFlat` en mode filtre, `distributeOrdered` sinon).

Algorithme `distributeByMotif` :
1. Grouper par `product_id`, motifs ordonnés `product_type → titre`.
2. Si `motifs >= cols` : packer des motifs entiers, greedy équilibré par quantité
   (même logique que `distributeOrdered`, groupé par motif).
3. Si `motifs < cols` : allouer ≥1 colonne par motif, distribuer les colonnes
   restantes aux plus gros motifs, et étaler (split) chaque motif sur ses colonnes
   (façon `distributeFlat`, borné aux colonnes du motif).

## Hors scope

- Toggle sur un type existant.
- Surcharge par instance.
