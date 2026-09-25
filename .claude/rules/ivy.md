# IVY — pièges et conventions

> Dépôt auto-déployé à chaque poussée sur `main`. L'état du produit vit dans le vault : `1. LE MÉTIER/4. IVY/_État.md`.
> Regroupé le 25/09/2026 depuis la mémoire locale, pour que ce savoir voyage avec le dépôt.

## ivy-dev-build-conflict

Dans le projet **IVY** (`~/desktop/devs/ivy`, Next.js 16 + Turbopack), lancer `pnpm build` pendant que le serveur `pnpm dev` / `next dev` tourne **corrompt le dossier `.next` partagé** → le serveur de dev se met à répondre **500** partout (`Cannot find module '[turbopack]_runtime.js'`, `ENOENT build-manifest.json`).

**Why:** dev et build écrivent dans le même `.next`. Ça a généré une fausse « erreur 500 sur la caisse » qui n'était PAS un bug de code.

**How to apply:** quand le dev server tourne, vérifier le code avec `pnpm exec tsc --noEmit` **uniquement** (jamais `pnpm build`). Le dire explicitement aux sous-agents. Pour réparer un dev wedgé : tuer le process sur le port, `Remove-Item -Recurse -Force .next`, relancer `next dev`. Voir [[ivy-location-id-shopify]].

## ivy-location-id-shopify

Dans **IVY**, `/api/locations` renvoie les emplacements **directement depuis l'API Shopify** (`id: location.id.toString()`). Donc `LocationContext.currentLocation.id` (sélecteur d'emplacement en haut de l'app) est un **id Shopify numérique en string**, et **non** l'UUID de la table Supabase `locations(id)`.

**Why:** scoper une donnée par emplacement en stockant `currentLocation.id` dans une colonne `UUID REFERENCES locations(id)` ne matche jamais. Ça a obligé à passer `location_id` en **TEXT** (sans FK) pour le module Comptes de stand.

**How to apply:** pour scoper par emplacement côté client, comparer/stocker l'id Shopify en TEXT. Si une vraie FK vers `locations` est requise, il faut d'abord mapper l'id Shopify → UUID via la table `locations` (vérifier si une colonne `shopify_location_id` existe). Lié à [[ivy-dev-build-conflict]].

## Feature branch for big migrations on Ivy (auto-deployed)

Ivy est **auto-déployé sur Netlify à chaque push sur `main`** (et non manuel comme indiqué dans le CLAUDE.md de la session — la doc est périmée et devrait être corrigée).

L'atelier utilise Ivy en production en continu pour gérer leurs commandes textile / festivals. Pousser un état intermédiaire (ex: la moitié des pages migrées en Atelier boréal et l'autre moitié en ancien design) déploie cet état mixte en prod et casse la cohérence visuelle ou l'expérience.

**Règle :** pour toute migration qui couvre plusieurs commits/tasks (ex: design system rollout, gros refactor, restructuration de scenes), créer une branche dédiée :

```bash
git checkout -b nom-de-la-migration
git push -u origin nom-de-la-migration
```

Et ne merger sur `main` que quand la migration est complète et testée. L'utilisateur déclenchera explicitement le merge.

**Why:** "Continue la migration sur une branche séparée, on a besoin d'IVY à l'atelier" (2026-04-16). Demande explicite après que la migration en cours ait causé un état intermédiaire visible en prod.

**How to apply:** Avant de lancer une série de commits qui modifient l'UI ou la structure, demander si on doit :
- Continuer sur main (petits changements, fixes urgents, features additives qui ne cassent pas l'existant) — ok
- Bifurquer sur une feature branch (refactor visuel, migration multi-pages, restructuration) — recommandé

Pour les fixes urgents (bugs prod, hotfixes), main reste OK.

## IVY — bumper APP_VERSION, puis commit ; le push suit la règle générale

**Propre à IVY** : après un changement de code, bumper `APP_VERSION` (patch) avant de committer.

⚠️ **La partie « push après chaque changement » est PÉRIMÉE.** Elle datait du 16/04/2026 ;
Uriel l'a révisée le **05/05/2026**. La règle en vigueur vit dans
`\EGIDE\Uriel Lahoussaye\🧠 Mon Cerveau\_Socle\Méthode.md` :

> Commit à chaque étape qui marche. Push **en fin de session**, quand un lot logique est terminé,
> ou quand Uriel signale qu'il change de poste. Pousser à chaque commit coûtait quatre minutes de
> hook Graphify et ~10 000 tokens sur un seul sprint.

**Rappel propre à IVY** : le dépôt est **auto-déployé à chaque poussée sur `main`**. Une migration
multi-commits passe donc par une branche séparée — un push à moitié fait est une production cassée.

## Un git pull ne rebâtit pas l'index Graphify

Le hook `post-commit` de Graphify ne se déclenche **que sur un commit fait localement**.
Un `git pull` qui ramène des commits d'un autre poste laisse `graphify-out/graph.json`
exactement là où il était.

**Constaté le 25/09/2026 sur IVY** : 60 commits tirés (le module douane, 15→21 septembre,
+4 500 lignes, 6 migrations), et `graph.json` datait toujours du 24 août. Un mois d'écart,
sans le moindre signal.

**How to apply** :
- Après tout `git pull` non vide, lancer `graphify update .`
- Contrôle de fraîcheur : comparer la date de `graphify-out/graph.json` à celle du dernier
  commit (`git log -1 --date=short`). **Pas** la date du dossier `graphify-out/` — elle ne
  bouge pas quand le fichier est réécrit en place, et c'est le piège qui a fait conclure à
  tort, le 25/09, que les index étaient morts.
- Uriel travaille depuis plusieurs postes : ce cas est la règle, pas l'exception.
