# HUB de stand — version responsive mobile (téléphone portrait)

> Date : 2026-06-06 · Page cible : `/ivy/hub` · Statut : validé (design), prêt pour plan d'implémentation

## Problème

Le HUB de stand (`/ivy/hub`) est l'outil de suivi de stock utilisé **sur les stands en festival**. Son layout actuel est un POS pensé pour desktop/tablette paysage :

- `SelectionZone` : colonnes d'options côte à côte en **scroll horizontal** (`min-width: 140px` chacune).
- `StockZone` : panier **fixe de 320px** à droite.

En portrait sur téléphone (~360–430px), les deux zones côte à côte + le scroll horizontal des colonnes sont inutilisables. Or le besoin est explicite : **pouvoir utiliser le hub sur téléphone, sur le stand, pour ajouter/retirer des mouvements de stock.**

## Objectif

Rendre `/ivy/hub` pleinement utilisable sur **téléphone portrait**, sans dégrader l'expérience desktop/tablette existante.

## Décisions (validées avec l'utilisateur)

| Sujet | Décision |
|-------|----------|
| Page | `/ivy/hub` uniquement |
| Cible | Téléphone portrait prioritaire (< 768px) |
| Pattern | **Drill-down** : une colonne plein écran à la fois |
| Toggle Sortie/Retour | **Sur la barre du bas** (accès rapide pendant la sélection) |
| Fil d'Ariane | **Cliquable** : taper un choix précédent rouvre cette étape et réinitialise les suivantes |
| Header haut | Le **`LocationSelector` existant** (emplacement Shopify), inchangé — pas de nom de festival |
| Desktop / tablette (≥ 768px) | **Inchangé** |

## Approche technique

Branche par media query, **sans toucher à la logique métier** :

```
useMediaQuery('(max-width: 767px)')  // dans page.tsx (CaissePage)
  ├─ false → layout actuel : <SelectionZone/> + <StockZone/> côte à côte  (INCHANGÉ)
  └─ true  → layout mobile : <HubMobile/>
```

Principe directeur : **réutilisation maximale**. Les hooks `useStockTracker` et `useProductSelection` ne changent pas. Tout le comportement (auto-ajout quand la variante est complète, reset, mode retour, gestion des colonnes masquées via `visibleColumns`) reste identique — seule la **présentation** mobile est nouvelle.

> Note SSR : `useMediaQuery` renvoie `undefined` au premier rendu serveur. La page hub est déjà `'use client'`. On traite `undefined` comme « non-mobile » (desktop par défaut) pour éviter un flash ; acceptable car l'usage mobile arrive après hydratation. À confirmer en test sur device.

## Composants

### Inchangés
- `StockZone.tsx` — réutilisé tel quel **dans le drawer mobile**.
- `SelectionZone.tsx` — chemin desktop uniquement.
- `useStockTracker.ts`, `useProductSelection.ts` — aucune modification.

### Nouveaux
- **`HubMobile.tsx`** — orchestration mobile. Reçoit les mêmes props que celles passées à `SelectionZone` + `StockZone` aujourd'hui (depuis `page.tsx`). Gère :
  - l'état « étape courante » (drill-down),
  - la barre du bas (compteur panier, toggle Sortie/Retour, Valider),
  - l'ouverture du drawer panier (`useDisclosure`).
- **`SelectionStep.tsx`** (optionnel, peut rester inline dans `HubMobile`) — rendu d'**une** colonne en plein écran : en-tête d'étape, fil d'Ariane cliquable, liste d'options tactiles.

### Modifiés
- **`page.tsx`** (`CaissePage`) — ajoute `useMediaQuery` et branche desktop/mobile. Les `optionColumnKeys` checkboxes (visibilité colonnes) restent dans le chemin desktop ; **masquées sur mobile** (les colonnes masquées deviennent des étapes sautées via `visibleColumns`).
- **`caisse.module.scss`** — nouvelles classes mobile + ajustements layout (voir ci-dessous).
- **`layout.tsx`** (`CaisseLayout`) — `height: 100vh` → `100dvh` (barre d'URL mobile) ; le header flottant (`.caisseHeader` : retour + `LocationSelector`) repositionné pour ne pas chevaucher l'étape sur petit écran.

## Layout mobile — 3 zones

### 1. En-tête
- Le `LocationSelector` existant (emplacement Shopify) + bouton retour, repris du `CaisseLayout`.
- En dessous : **indicateur d'étape** (`Étape X / N` + titre de la colonne courante) et **fil d'Ariane** des choix faits.

### 2. Fil d'Ariane (cliquable)
- Affiche les choix validés (ex. `Bagues › Rune d'argent ›`) et les étapes restantes (en pointillé).
- Taper un choix validé → **rouvre cette étape et réinitialise les sélections des colonnes suivantes** (s'appuie sur `selectColumn` / la logique de progression existante `previousFilled`).
- Une barre de progression fine reflète l'avancement.

### 3. Colonne courante (plein écran)
- **Une seule colonne** affichée : la première colonne active sans sélection (dérivée de `activeColumns` + `selections`).
- Boutons d'option pleine largeur, cibles tactiles **≥ 48px** (maquette : 54px), pastille couleur (`getColorHex`) + compteur de stock conservés.
- Rupture de stock : style `clay` (non bloquant, comme aujourd'hui).
- Taper une valeur → `selectColumn` → passe à l'étape suivante. Dernière étape → variante complète → **auto-ajout** (effet existant dans `SelectionZone`… voir risque ci-dessous) → reset → retour étape 1.

### 4. Barre panier collante (bas)
- `[🛒 N]` (compteur de mouvements) — taper ouvre le **drawer panier**.
- Toggle **Sortie / Retour** (`isReturnMode` / `setReturnMode`) — directement sur la barre.
- Bouton **Valider** (`onConfirm`), désactivé si panier vide, `loading` pendant `processing`.

### 5. Drawer panier (Mantine `Drawer position="bottom"`)
- Contient le **`StockZone` complet** réutilisé : liste des mouvements, undo par ligne, vider, totaux, et `Valider les mouvements`.
- Retours affichés en `plum` (style existant).
- Note : le toggle Sortie/Retour et le bouton Valider existent **aussi** dans `StockZone`. C'est une redondance assumée (barre = accès rapide, drawer = vue complète) ; les deux pilotent le même état, donc cohérents.

## Risque identifié — auto-add dépend du remontage

`SelectionZone` déclenche l'auto-ajout via `useEffect(..., [selectedVariant])`. Si `HubMobile` réimplémente le rendu des colonnes **sans** réutiliser cet effet, il faut **reproduire l'auto-ajout** (même dépendance `selectedVariant` + `selectedProduct`). Deux options :
- **(A)** Extraire l'effet auto-add dans un petit hook partagé (`useAutoAddMovement`) consommé par `SelectionZone` ET `HubMobile` → pas de duplication, comportement garanti identique.
- **(B)** Dupliquer l'effet dans `HubMobile`.

**Recommandation : (A)** — évite la divergence de comportement entre desktop et mobile. À acter dans le plan.

## Breakpoint

- Mobile : `max-width: 767px`.
- Tablette (≥ 768px) : conserve le layout deux-zones actuel (jugé acceptable par l'utilisateur, priorité = téléphone).

## Hors périmètre (YAGNI)

- Le tableau de bord Festivals (`/ivy/stand`) — non concerné.
- La sidebar `IvyLayout` / `TopNavbar` — le hub a son propre `CaisseLayout` plein écran, sans sidebar ni topnav.
- Réorganisation des colonnes (flèches ‹ › de `SelectionZone`) sur mobile — remplacée par le fil d'Ariane cliquable ; les flèches restent desktop-only.
- Gestion de la visibilité des colonnes sur mobile (cases à cocher) — masquée ; report possible ultérieur dans le drawer.

## Critères de succès

1. Sur téléphone portrait, on peut sélectionner une variante complète (Type → Produit → options) une étape à la fois, sans scroll horizontal.
2. On peut basculer Sortie/Retour depuis la barre du bas.
3. On peut ouvrir le panier, annuler une ligne, vider, et valider — les mouvements sont écrits via `/api/pos/stock/adjust` (inchangé).
4. On peut corriger une étape précédente via le fil d'Ariane.
5. Le layout desktop/tablette (≥ 768px) est strictement identique à l'actuel.
6. `pnpm build` passe (TypeScript strict, pas de `any`).

## Vérification

Pas de framework de tests. Vérification manuelle via `pnpm dev` :
- DevTools en mode responsive (iPhone SE 375px, Pixel) pour le parcours complet.
- Contrôle qu'à ≥ 768px rien n'a bougé.
