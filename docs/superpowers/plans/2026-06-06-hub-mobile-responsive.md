# HUB de stand — responsive mobile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre la page `/ivy/hub` (HUB de stand) pleinement utilisable sur téléphone portrait via un parcours drill-down, sans changer le desktop/tablette.

**Architecture:** Branche par `useMediaQuery('(max-width: 767px)')` dans `page.tsx`. En dessous de 768px on rend un nouveau composant `HubMobile` (une colonne d'options plein écran à la fois + fil d'Ariane cliquable + barre panier collante + drawer panier qui réutilise `StockZone`). Toute la logique métier reste dans les hooks existants (`useProductSelection`, `useStockTracker`), non modifiés. L'auto-ajout au panier est extrait dans un hook partagé `useAutoAddMovement` pour garantir un comportement identique desktop/mobile.

**Tech Stack:** Next.js 16, React 19, TypeScript strict, Mantine 7 (`@mantine/core` Drawer/Button, `@mantine/hooks` useMediaQuery/useDisclosure), Tabler Icons, SCSS modules.

**Note tests :** Le projet n'a **pas** de framework de tests (cf. `CLAUDE.md`). La vérification de chaque tâche se fait via `pnpm build` (typecheck strict) et une vérification manuelle finale au `pnpm dev` en mode responsive. Les « steps » de test classiques sont remplacés par ces vérifications.

**Pré-requis :** Travailler sur la branche `feat/hub-mobile-responsive` (déjà créée, contient le spec + la maquette).

---

## File Structure

| Fichier | Action | Responsabilité |
|---------|--------|----------------|
| `src/app/ivy/hub/hooks/useAutoAddMovement.ts` | **Créer** | Effet d'auto-ajout d'un mouvement quand la variante est complète (partagé desktop/mobile) |
| `src/app/ivy/hub/components/SelectionZone.tsx` | **Modifier** | Remplacer l'effet inline par `useAutoAddMovement` (desktop inchangé fonctionnellement) |
| `src/app/ivy/hub/components/HubMobile.tsx` | **Créer** | Layout mobile complet : drill-down + barre + drawer panier |
| `src/app/ivy/hub/caisse.module.scss` | **Modifier** | Classes mobile + `.cartZone` pleine largeur en mobile + `100dvh` |
| `src/app/ivy/hub/page.tsx` | **Modifier** | Branche desktop/mobile + masquer les toggles colonnes en mobile |
| `src/config/version.ts` | **Modifier** | Bump version (étape finale) |

---

## Task 1 : Extraire l'auto-ajout dans un hook partagé

**Files:**
- Create: `src/app/ivy/hub/hooks/useAutoAddMovement.ts`
- Modify: `src/app/ivy/hub/components/SelectionZone.tsx`

- [ ] **Step 1 : Créer le hook `useAutoAddMovement`**

Créer `src/app/ivy/hub/hooks/useAutoAddMovement.ts` avec exactement :

```ts
'use client';

import { useEffect } from 'react';
import { StockMovement, VariantOption, SelectedProduct } from '../types';
import { ColumnKey } from './useProductSelection';

/**
 * Auto-ajoute un mouvement de stock dès qu'une variante est entièrement
 * sélectionnée. Extrait de SelectionZone pour être partagé avec le layout
 * mobile (HubMobile) — garantit un comportement identique desktop/mobile.
 *
 * Dépendance volontairement limitée à `selectedVariant` : l'effet ne doit se
 * déclencher qu'au moment où la variante devient complète (comportement
 * historique de SelectionZone).
 */
export function useAutoAddMovement(
  selectedVariant: VariantOption | null,
  selectedProduct: SelectedProduct | null,
  columnOrder: ColumnKey[],
  selections: Record<ColumnKey, string | null>,
  onAddMovement: (item: Omit<StockMovement, 'quantity'>) => void,
): void {
  useEffect(() => {
    if (selectedVariant && selectedProduct) {
      const optionParts: string[] = [];
      for (const key of columnOrder) {
        if (key.startsWith('opt') && selections[key]) {
          optionParts.push(selections[key]!);
        }
      }

      onAddMovement({
        variantId: selectedVariant.variantId!,
        productId: selectedProduct.id,
        productTitle: selectedProduct.title,
        productType: selectedProduct.productType,
        variantTitle: optionParts.join(' / '),
        options: {},
        stock: selectedVariant.stock,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariant]);
}
```

- [ ] **Step 2 : Brancher le hook dans `SelectionZone` et retirer l'effet inline**

Dans `src/app/ivy/hub/components/SelectionZone.tsx` :

Remplacer la ligne d'import React (ligne 3) :

```tsx
import { useEffect, useState } from 'react';
```

par :

```tsx
import { useAutoAddMovement } from '../hooks/useAutoAddMovement';
import { SelectedProduct } from '../types';
```

(Note : `useEffect`/`useState` ne sont plus utilisés après ce refactor ; le JSX n'exige pas d'import React en Next 16.)

Mettre à jour le type de la prop `selectedProduct` dans l'interface `SelectionZoneProps` — remplacer :

```tsx
  selectedProduct: { id: string; title: string; productType: string } | null;
```

par :

```tsx
  selectedProduct: SelectedProduct | null;
```

Supprimer entièrement le bloc effet inline (actuellement lignes ~42-62) :

```tsx
  // Auto-add movement when variant is fully selected
  useEffect(() => {
    if (selectedVariant && selectedProduct) {
      const optionParts: string[] = [];
      for (const key of columnOrder) {
        if (key.startsWith('opt') && selections[key]) {
          optionParts.push(selections[key]!);
        }
      }

      onAddMovement({
        variantId: selectedVariant.variantId!,
        productId: selectedProduct.id,
        productTitle: selectedProduct.title,
        productType: selectedProduct.productType,
        variantTitle: optionParts.join(' / '),
        options: {},
        stock: selectedVariant.stock,
      });
    }
  }, [selectedVariant]);
```

et le remplacer par l'appel au hook (au même endroit, juste après la déstructuration des props dans le corps du composant) :

```tsx
  useAutoAddMovement(selectedVariant, selectedProduct, columnOrder, selections, onAddMovement);
```

- [ ] **Step 3 : Vérifier le typecheck**

Run: `pnpm build`
Expected: build réussit (pas d'erreur TypeScript). Le comportement desktop est inchangé.

- [ ] **Step 4 : Commit**

```bash
git add src/app/ivy/hub/hooks/useAutoAddMovement.ts src/app/ivy/hub/components/SelectionZone.tsx
git commit -m "refactor(hub): extrait l'auto-ajout dans useAutoAddMovement (partage desktop/mobile)"
```

---

## Task 2 : Styles mobile + `.cartZone` responsive + `100dvh`

**Files:**
- Modify: `src/app/ivy/hub/caisse.module.scss`

- [ ] **Step 1 : Passer la hauteur du layout en `100dvh`**

Dans `src/app/ivy/hub/caisse.module.scss`, dans `.caisseLayout`, remplacer :

```scss
  height: 100vh;
```

par :

```scss
  height: 100dvh;
```

- [ ] **Step 2 : Ajouter les classes mobile en fin de fichier**

Ajouter à la fin de `src/app/ivy/hub/caisse.module.scss` :

```scss
// ============================================================
// Mobile hub (drill-down) — téléphone portrait < 768px
// ============================================================
.mobileHub {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  min-height: 0;
  background: $cream;
}

.mobileLoading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mobileHead {
  padding: 56px $space-base 8px; // espace pour le header flottant (retour + LocationSelector)
}

.mobileStepRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.mobileStepTitle {
  font-family: $font-fraunces;
  font-size: 22px;
  color: $slate;
}

.mobileStepCount {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: $slate-muted;
  background: $cream-soft;
  border: 1px solid $divider;
  border-radius: $radius-pill;
  padding: 4px 11px;
  white-space: nowrap;
}

.mobileCrumbs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.mobileCrumbWrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.mobileCrumb {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: $radius-pill;
  background: $moss-bg;
  color: $moss;
  border: none;
  cursor: pointer;
  font-family: $font-inter;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobileCrumbTodo {
  background: transparent;
  color: $slate-muted;
  border: 1px dashed $divider-strong;
  font-weight: 500;
  cursor: default;
}

.mobileCrumbSep {
  color: $slate-muted;
  font-size: 12px;
}

.mobileProgress {
  height: 4px;
  background: $cream-warm;
  border-radius: $radius-pill;
  margin-top: 12px;
  overflow: hidden;

  i {
    display: block;
    height: 100%;
    background: $moss;
    border-radius: $radius-pill;
    transition: width 0.2s ease;
  }
}

.mobileOptions {
  flex: 1;
  overflow-y: auto;
  padding: 4px $space-base $space-base;
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-height: 0;
}

.mobileEmpty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $slate-muted;
  padding: 2rem;
}

.mobileOpt {
  min-height: 54px;
  padding: 0 $space-base;
  border: 2px solid transparent;
  border-radius: $radius-md;
  background: $cream-soft;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  font-size: 16px;
  color: $slate;
  text-align: left;
  box-shadow: 0 1px 2px rgba(26, 31, 42, 0.04);
  font-family: $font-inter;

  &:active {
    background: $cream-warm;
  }
}

.mobileOptOos {
  background: $clay-bg;
  opacity: 0.75;

  .mobileOptStock {
    color: $clay;
    font-weight: 600;
  }
}

.mobileOptLabel {
  flex: 1;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobileOptStock {
  font-size: 13px;
  color: $slate-muted;
  font-family: $font-jetbrains;
}

.mobileSwatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid $divider-strong;
  flex-shrink: 0;
}

.mobileBar {
  border-top: 1px solid $divider;
  background: $cream-soft;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.mobileCartChip {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  border-radius: $radius-md;
  background: $cream;
  border: 1px solid $divider;
  font-weight: 600;
  color: $slate;
  cursor: pointer;
}

.mobileCount {
  background: $slate;
  color: $cream;
  border-radius: $radius-pill;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
}

.mobileRetour {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 12px;
  border-radius: $radius-md;
  background: $cream;
  border: 1px solid $divider;
  font-size: 13px;
  font-weight: 600;
  color: $slate-soft;
  cursor: pointer;
  font-family: $font-inter;
  white-space: nowrap;
}

.mobileRetourOn {
  background: $clay-bg;
  border-color: $clay;
  color: $clay;
}

.mobileValid {
  flex: 1;
}

// StockZone réutilisé dans le drawer panier : pleine largeur sur mobile
@media (max-width: 767px) {
  .cartZone {
    width: 100%;
    min-width: 0;
    border-left: none;
    height: 100%;
  }
}
```

- [ ] **Step 3 : Vérifier le typecheck/compilation SCSS**

Run: `pnpm build`
Expected: build réussit (le SCSS compile, classes non encore utilisées = OK).

- [ ] **Step 4 : Commit**

```bash
git add src/app/ivy/hub/caisse.module.scss
git commit -m "style(hub): classes mobile drill-down + cartZone pleine largeur + 100dvh"
```

---

## Task 3 : Composant `HubMobile`

**Files:**
- Create: `src/app/ivy/hub/components/HubMobile.tsx`

- [ ] **Step 1 : Créer `HubMobile.tsx`**

Créer `src/app/ivy/hub/components/HubMobile.tsx` avec exactement :

```tsx
'use client';

import { Loader, Drawer, Button } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconShoppingCart, IconRotate } from '@tabler/icons-react';
import { StockMovement, VariantOption, SelectedProduct } from '../types';
import { ColumnKey, ColumnValue } from '../hooks/useProductSelection';
import { useAutoAddMovement } from '../hooks/useAutoAddMovement';
import { getColorHex } from '@/utils/color-transformer';
import { StockZone } from './StockZone';
import styles from '../caisse.module.scss';

function isColorColumn(label: string): boolean {
  const lower = label.toLowerCase();
  return lower.includes('couleur') || lower.includes('color');
}

interface HubMobileProps {
  // Sélection
  loading: boolean;
  columns: ColumnKey[]; // colonnes visibles (= visibleColumns du parent)
  columnOrder: ColumnKey[];
  selections: Record<ColumnKey, string | null>;
  selectColumn: (key: ColumnKey, value: string) => void;
  resetSelection: () => void;
  getValuesForColumn: (key: ColumnKey) => ColumnValue[];
  getColumnLabel: (key: ColumnKey) => string;
  selectedVariant: VariantOption | null;
  selectedProduct: SelectedProduct | null;
  onAddMovement: (item: Omit<StockMovement, 'quantity'>) => void;
  // Panier
  movements: StockMovement[];
  totalOut: number;
  totalReturn: number;
  isReturnMode: boolean;
  onUndo: (variantId: string) => void;
  onClear: () => void;
  onToggleReturnMode: (enabled: boolean) => void;
  onConfirm: () => void;
  processing: boolean;
}

export function HubMobile({
  loading, columns, columnOrder, selections, selectColumn, resetSelection,
  getValuesForColumn, getColumnLabel, selectedVariant, selectedProduct, onAddMovement,
  movements, totalOut, totalReturn, isReturnMode, onUndo, onClear,
  onToggleReturnMode, onConfirm, processing,
}: HubMobileProps) {
  const [cartOpened, cart] = useDisclosure(false);

  // Auto-ajout partagé avec le desktop
  useAutoAddMovement(selectedVariant, selectedProduct, columnOrder, selections, onAddMovement);

  const totalCount = totalOut + totalReturn;
  const totalSteps = columns.length;

  // Étape courante = première colonne visible sans sélection
  const stepIndex = columns.findIndex(k => !selections[k]);
  const currentKey = stepIndex === -1 ? null : columns[stepIndex];

  // Label d'une colonne déjà remplie (fil d'Ariane)
  const crumbLabel = (key: ColumnKey): string => {
    if (key === 'product') return selectedProduct?.title ?? selections[key] ?? '';
    return selections[key] ?? '';
  };

  // Rouvrir l'étape i : re-sélectionner la valeur courante de la colonne i-1
  // efface automatiquement tout ce qui suit (cf. selectColumn). i <= 0 → reset.
  const reopenStep = (i: number) => {
    if (i <= 0) { resetSelection(); return; }
    const prevKey = columns[i - 1];
    const prevValue = selections[prevKey];
    if (prevValue) selectColumn(prevKey, prevValue);
  };

  if (loading) {
    return (
      <div className={styles.mobileHub}>
        <div className={styles.mobileLoading}><Loader color="moss" size="lg" /></div>
      </div>
    );
  }

  const values = currentKey ? getValuesForColumn(currentKey) : [];
  const isColor = currentKey ? isColorColumn(getColumnLabel(currentKey)) : false;
  const reachedSteps = stepIndex === -1 ? totalSteps : stepIndex;
  const progressPct = totalSteps > 0 ? Math.round((reachedSteps / totalSteps) * 100) : 0;
  const stepLabel = Math.min(reachedSteps + 1, totalSteps);

  return (
    <div className={styles.mobileHub}>
      <div className={styles.mobileHead}>
        <div className={styles.mobileStepRow}>
          <div className={styles.mobileStepTitle}>
            {currentKey ? getColumnLabel(currentKey) : '—'}
          </div>
          <div className={styles.mobileStepCount}>
            Étape {stepLabel} / {totalSteps}
          </div>
        </div>

        <div className={styles.mobileCrumbs}>
          {columns.map((key, i) => {
            const isFilled = stepIndex === -1 || i < stepIndex;
            const isCurrent = i === stepIndex;
            if (isCurrent) return null; // colonne courante = titre, pas dans le fil
            const notLast = i < columns.length - 1;
            return (
              <span key={key} className={styles.mobileCrumbWrap}>
                {isFilled ? (
                  <button
                    type="button"
                    className={styles.mobileCrumb}
                    onClick={() => reopenStep(i)}
                  >
                    {(crumbLabel(key) || getColumnLabel(key)) + ' ✕'}
                  </button>
                ) : (
                  <span className={`${styles.mobileCrumb} ${styles.mobileCrumbTodo}`}>
                    {getColumnLabel(key)}
                  </span>
                )}
                {notLast && <span className={styles.mobileCrumbSep}>›</span>}
              </span>
            );
          })}
        </div>

        <div className={styles.mobileProgress}>
          <i style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <div className={styles.mobileOptions}>
        {!currentKey ? (
          <div className={styles.mobileEmpty}><Loader color="moss" /></div>
        ) : values.length === 0 ? (
          <div className={styles.mobileEmpty}>—</div>
        ) : (
          values.map(item => {
            const hex = isColor ? getColorHex(item.label) : null;
            const isOos = item.stock <= 0;
            return (
              <button
                key={item.value}
                className={`${styles.mobileOpt} ${isOos ? styles.mobileOptOos : ''}`}
                onClick={() => selectColumn(currentKey, item.value)}
              >
                {hex && <span className={styles.mobileSwatch} style={{ backgroundColor: hex }} />}
                <span className={styles.mobileOptLabel}>{item.label}</span>
                <span className={styles.mobileOptStock}>{item.stock}</span>
              </button>
            );
          })
        )}
      </div>

      <div className={styles.mobileBar}>
        <button type="button" className={styles.mobileCartChip} onClick={cart.open}>
          <IconShoppingCart size={18} />
          <span className={styles.mobileCount}>{totalCount}</span>
        </button>
        <button
          type="button"
          className={`${styles.mobileRetour} ${isReturnMode ? styles.mobileRetourOn : ''}`}
          onClick={() => onToggleReturnMode(!isReturnMode)}
        >
          <IconRotate size={16} />
          {isReturnMode ? 'Retour' : 'Sortie'}
        </button>
        <Button
          className={styles.mobileValid}
          color="moss"
          size="md"
          disabled={movements.length === 0}
          loading={processing}
          onClick={onConfirm}
        >
          Valider
        </Button>
      </div>

      <Drawer
        opened={cartOpened}
        onClose={cart.close}
        position="bottom"
        size="85%"
        withCloseButton={false}
        padding={0}
        styles={{
          content: { display: 'flex', flexDirection: 'column' },
          body: { padding: 0, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 },
        }}
      >
        <StockZone
          movements={movements}
          totalOut={totalOut}
          totalReturn={totalReturn}
          isReturnMode={isReturnMode}
          onUndo={onUndo}
          onClear={onClear}
          onToggleReturnMode={onToggleReturnMode}
          onConfirm={() => { onConfirm(); cart.close(); }}
          processing={processing}
        />
      </Drawer>
    </div>
  );
}
```

- [ ] **Step 2 : Vérifier le typecheck**

Run: `pnpm build`
Expected: build réussit. `HubMobile` compile (encore non utilisé = warning éventuel d'import non utilisé côté page, ignoré ici car non importé encore).

- [ ] **Step 3 : Commit**

```bash
git add src/app/ivy/hub/components/HubMobile.tsx
git commit -m "feat(hub): composant HubMobile (drill-down + barre + drawer panier)"
```

---

## Task 4 : Brancher desktop/mobile dans `page.tsx`

**Files:**
- Modify: `src/app/ivy/hub/page.tsx`

- [ ] **Step 1 : Ajouter les imports**

Dans `src/app/ivy/hub/page.tsx`, après l'import existant `import { Checkbox } from '@mantine/core';` (ligne 5), ajouter :

```tsx
import { useMediaQuery } from '@mantine/hooks';
import { HubMobile } from './components/HubMobile';
```

- [ ] **Step 2 : Détecter le mobile**

Dans le corps de `CaissePage`, juste après `const [processing, setProcessing] = useState(false);` (ligne ~19), ajouter :

```tsx
  const isMobile = useMediaQuery('(max-width: 767px)');
```

- [ ] **Step 3 : Brancher le rendu mobile avant le `return` desktop**

Juste **avant** le `return (` final (celui qui ouvre `<div className={styles.caisseContainer}>`, ligne ~125), insérer :

```tsx
  if (isMobile) {
    return (
      <div className={styles.caisseContainer}>
        <HubMobile
          loading={ps.loading}
          columns={visibleColumns}
          columnOrder={ps.columnOrder}
          selections={ps.selections}
          selectColumn={ps.selectColumn}
          resetSelection={ps.resetSelection}
          getValuesForColumn={ps.getValuesForColumn}
          getColumnLabel={ps.getColumnLabel}
          selectedVariant={ps.selectedVariant}
          selectedProduct={ps.selectedProduct}
          onAddMovement={handleAddMovement}
          movements={tracker.movements}
          totalOut={tracker.totalOut}
          totalReturn={tracker.totalReturn}
          isReturnMode={tracker.isReturnMode}
          onUndo={tracker.undoMovement}
          onClear={tracker.clearMovements}
          onToggleReturnMode={tracker.setReturnMode}
          onConfirm={handleConfirm}
          processing={processing}
        />
      </div>
    );
  }
```

> Rationale SSR : au premier rendu (serveur + hydratation client) `useMediaQuery` renvoie `undefined` → falsy → on rend le desktop. Après montage, sur téléphone la media query passe à `true` et bascule sur `HubMobile`. Pas de mismatch d'hydratation (serveur et 1er rendu client identiques).

- [ ] **Step 4 : (Déjà couvert) toggles colonnes**

Les cases de visibilité de colonnes (`optionColumnKeys`) restent uniquement dans le `return` desktop, qui n'est **plus atteint** en mobile (return anticipé ci-dessus). Aucune modification supplémentaire nécessaire — vérifier juste qu'on n'a rien dupliqué dans la branche mobile (le bloc `columnToggles` ne doit PAS être dans `HubMobile`).

- [ ] **Step 5 : Vérifier le typecheck**

Run: `pnpm build`
Expected: build réussit, aucun import inutilisé, types alignés.

- [ ] **Step 6 : Commit**

```bash
git add src/app/ivy/hub/page.tsx
git commit -m "feat(hub): branche le layout mobile (HubMobile) sous 768px"
```

---

## Task 5 : Vérification manuelle, bump version, push

**Files:**
- Modify: `src/config/version.ts`

- [ ] **Step 1 : Lancer le dev server**

Run: `pnpm dev`
Ouvrir `http://localhost:3000/ivy/hub`.

- [ ] **Step 2 : Vérifier le desktop (≥ 768px)**

Fenêtre large : le layout doit être **strictement identique** à l'actuel — `SelectionZone` (colonnes horizontales) + `StockZone` (panier 320px à droite) + cases de visibilité des colonnes. Sélectionner une variante complète → auto-ajout au panier OK.

- [ ] **Step 3 : Vérifier le mobile (DevTools responsive, iPhone SE 375px)**

Parcours à valider :
1. Le drill-down montre **une colonne à la fois** (Type d'abord), sans scroll horizontal.
2. Taper une option fait avancer à l'étape suivante ; le fil d'Ariane se remplit.
3. Sélectionner jusqu'à une variante complète → mouvement **auto-ajouté**, retour à l'étape 1, compteur `🛒` incrémenté.
4. Toggle **Sortie/Retour** sur la barre du bas : passe en « Retour », un nouvel ajout crée un mouvement `+1` (violet dans le panier).
5. Taper `🛒 N` → le **drawer** s'ouvre : liste des mouvements, undo `↶` par ligne, vider, `Valider les mouvements`.
6. Taper un élément **rempli** du fil d'Ariane → rouvre cette étape, les étapes suivantes sont réinitialisées.
7. Une option à stock 0 s'affiche en argile (clay) et reste sélectionnable (non bloquant).
8. `Valider` (barre ou drawer) écrit les mouvements et vide le panier (notification de succès).

- [ ] **Step 4 : Bump version**

Dans `src/config/version.ts`, incrémenter le patch — remplacer :

```ts
export const APP_VERSION = '0.5.74 - Ivy';
```

par :

```ts
export const APP_VERSION = '0.5.75 - Ivy';
```

- [ ] **Step 5 : Build final**

Run: `pnpm build`
Expected: build de production réussit.

- [ ] **Step 6 : Commit + push**

```bash
git add src/config/version.ts
git commit -m "chore: bump version 0.5.75 (hub mobile responsive)"
git push -u origin feat/hub-mobile-responsive
```

---

## Self-Review (effectué)

**Couverture du spec :**
- Drill-down téléphone < 768px → Task 4 (branche) + Task 3 (HubMobile) ✓
- Toggle Sortie/Retour sur la barre → Task 3 (`mobileBar`) ✓
- Fil d'Ariane cliquable → Task 3 (`reopenStep`) ✓
- Header = LocationSelector existant inchangé → aucun changement layout, padding `mobileHead` 56px pour ne pas chevaucher ✓
- Réutilisation `StockZone` dans drawer → Task 3 ✓
- Hooks métier inchangés → seul ajout = `useAutoAddMovement` (Task 1) ✓
- Auto-ajout extrait (option A du spec) → Task 1 ✓
- `100dvh` → Task 2 ✓
- Masquer toggles colonnes en mobile → Task 4 step 4 (return anticipé) ✓
- Desktop/tablette ≥ 768px inchangé → branche mobile isolée, media query 767px ✓
- `pnpm build` passe → vérif chaque tâche ✓

**Cohérence des types/signatures :** `HubMobileProps` reprend exactement les signatures de `useProductSelection`/`useStockTracker` (`selectColumn(key,value)`, `setReturnMode(enabled)`, `undoMovement(variantId)`, `clearMovements()`, `resetSelection()`) et passe à `StockZone` les props exactes de `StockZoneProps`. `useAutoAddMovement` reçoit `SelectedProduct` (type aligné avec `ps.selectedProduct`). Prop `selectedProduct` de `SelectionZone` élargie à `SelectedProduct` pour matcher le hook.

**Placeholders :** aucun — tout le code est fourni.

**Risque connu :** si on traverse la frontière 768px en cours de sélection (variante complète à l'instant T), l'effet `useAutoAddMovement` peut re-déclencher au remontage. Au repos `selectedVariant` est `null` (reset post-ajout), donc sans impact réel sur téléphone. Non traité (YAGNI).
