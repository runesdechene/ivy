# Ventes reconstituées — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Plan volontairement condensé** (départ le lendemain) : fichiers, interfaces et vérifications sont
> fixés ici ; le code s'écrit en exécution, chaque module pur étant précédé de son script de
> vérification (échec constaté, puis succès). Les algorithmes reprennent le prototype validé sur les
> données d'août (`scratchpad/repartition_v4.mjs`).

**Goal:** Reconstituer au retour une liste de ventes par produit, cohérente au centime avec SumUp et les espèces, et refaire la synthèse du 11.87 dessus.

**Architecture:** deux modules purs (`sumup.ts` lecture du rapport, `reconstitution.ts` algorithme), une route qui les enchaîne et fige le résultat en JSONB sur le passage, un rendu de la liste et une synthèse du 11.87 refaite. Référentiel enrichi du prix affiché et du prix minimal.

**Tech Stack:** Next.js 16, TypeScript strict, Mantine 7, Supabase (MCP), Node 22 (`zlib`) pour le zip.

**Spec:** `docs/superpowers/specs/2026-09-15-douane-ventes-reconstituees-design.md`

## Global Constraints

- Ivy n'est pas une caisse : aucune écriture dans le stock ni `stock_movements` ; jamais le mot « caisse ».
- TVA suisse **par-dessus** le CA déclaré ; total TVA arrondi aux 5 centimes.
- CA déclaré = SumUp EUR × taux du passage + espèces CHF + espèces EUR × taux.
- Montants en centimes entiers dans les calculs ; aucun total recalculé depuis une moyenne.
- Quantité vendue par type = max(0, parti − revenu) au niveau du **type**.
- Aucune dépendance npm ajoutée. pnpm, TypeScript strict, pas de `any`.
- Projet Supabase `monessruufklcrrhzvub` ; renommer la version de migration en `063`.
- `APP_VERSION` +1 par commit touchant `src/` (script `commit.ps1 -Bump`).
- Rien n'est fusionné dans `main` sans vérification complète et accord d'Uriel.

---

### Task 1: Migration 063

**Files:** Create `supabase/migrations/063_customs_ventes.sql`

- [ ] `customs_type_tariffs` : `prix_affiche_chf`, `prix_minimal_chf` DECIMAL(10,2) + CHECK minimal ≤ affiché ; amorce Confort 50/20, Débardeurs 40/15, Moelleux 90/70, Zippé 110/80, Éternel NULL/80.
- [ ] `customs_declarations.reconstitution JSONB`.
- [ ] Appliquer (MCP), renuméroter `063`, relire les valeurs. Commit.

### Task 2: Lecture du rapport SumUp — `src/lib/customs/sumup.ts`

**Produces:** `lireRapportSumUp(fichier: Uint8Array): { paiements: PaiementSumUp[]; devise: string }`,
`interface PaiementSumUp { ref: string; date: string /* ISO local AAAA-MM-JJTHH:MM */; eur: number }`.

- [ ] Script `scratchpad/check-sumup.mts` : rapport 01-02/08 → 88 paiements, 4 539,00 € ; rapport 27-30/08 → 61 paiements, 5 331,95 €, dont `TAAA43LQEBE` = 106,64 € (deux lignes) ; dates « 27 août 2026 18:07 » → `2026-08-27T18:07`. Constater l'échec.
- [ ] Implémenter : zip (répertoire central + `inflateRawSync`), `sharedStrings`, `sheet1`, colonnes par en-tête, ventes − remboursements, regroupement par référence. Succès. Commit.

### Task 3: Algorithme — `src/lib/customs/reconstitution.ts`

**Produces:**
- `interface PieceVendue { type: string; piece: string; coutEur: number }`
- `interface PrixType { affiche: number; minimal: number }`
- `reconstituer(e: { pieces: PieceVendue[]; paiements: PaiementSumUp[]; especesChf: number; especesEur: number; taux: number; prix: Record<string, PrixType> }): Reconstitution` (lève `ErreurReconstitution` avec message explicite)
- `estimerTauxSumUp(paiements): number`
- `piecesVenduesDuPassage(items): PieceVendue[]` (quantité par type = parti − revenu)
- `syntheseParType(r: Reconstitution): { type; sorties; offertes; caCentimes; tvaCentimes }[]` + `tvaAPayerCentimes(total)` (arrondi 5 ct)

- [ ] Script `scratchpad/check-reconstitution.mts` : août → 125 pièces, 5 012,03 CHF, prix ≤ affiché, ≥ minimal ou offert, chaque pièce une fois, synthèse Le Zippé 6×80 et Le Moelleux 2×90 + 10×70 (comme `repartition_v4`), TVA 405,97 → 405,95 ; espèces 100 CHF + 50 € sur un petit jeu ; erreurs : encaissé > catalogue, prix manquant. Échec constaté.
- [ ] Implémenter (port de `repartition_v4` + espèces + estimation du taux). Succès. Commit.

### Task 4: API

**Files:** `src/app/api/customs/passages/[id]/reconstitution/route.ts` (POST multipart `fichier`, `especesChf`, `especesEur` → calcule, fige, renvoie ; DELETE → efface) ; `src/app/api/settings/customs-tariffs/route.ts` (prix) ; `src/lib/customs/tariffs.ts` (types).

- [ ] POST sur un passage ouvert → 409 ; sans prix pour un type vendu → 400 explicite.
- [ ] Vérification sur le serveur de dev avec le rapport de Fribourg sur le passage d'août. Commit.

### Task 5: Documents

**Files:** `src/lib/customs/render-ventes.ts` + route `.../[id]/ventes/route.ts` ; `src/lib/customs/render-passage.ts` (synthèse 11.87).

- [ ] Script : la synthèse d'août a CA 5 012,03 et TVA 405,95 ; chaque ligne type = somme des lignes de la liste ; aucune occurrence de « caisse », « prix moyen », « Base imposable ». Échec puis succès.
- [ ] Commit.

### Task 6: Écrans

**Files:** `src/app/parametres/douane/page.tsx` (2 colonnes) ; `src/app/ivy/inventaire/douane/[id]/page.tsx` (cadre « Ventes reconstituées », passage clôturé).

- [ ] `tsc`, pages en 200 sur le serveur de dev. Commit.

### Task 7: Vérification finale

- [ ] Reconstitution d'août de bout en bout via l'API ; feuille et liste relues ; `pnpm build`.
- [ ] Rapport à Uriel ; fusion seulement avec son accord.
