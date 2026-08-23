---
updated: 2026-08-23T00:00:00Z
summary: "Le stand se synchronise enfin avec Shopify. Validé en vrai."
next_step: "Finir les tests du stand : panne de wifi, retours, journal."
---

<!-- Statut lu par XO sur la carte d'accueil. À tenir à jour à chaque session :
• updated   : date ISO de la dernière session (ex. 2026-06-21T14:00:00Z) → badge d'âge
• next_step : une phrase de reprise (où on en est / prochaine étape) → ligne ↩ sur la carte
Les tâches affichées viennent de la note Obsidian reliée à la carte (✎), pas d'ici. -->

## Tâches

- [x] Synchro Shopify du stand — testée en vrai le 2026-08-23, la quantité bouge bien
- [ ] **Festival dans 3 jours** — finir les tests sur le téléphone du stand
- [ ] Variante locale, variante retirée de Shopify, mode retour
- [ ] Couper le wifi en pleine validation → panier rouge, rien décompté, revalider une fois reconnecté
- [ ] Vérifier que les mouvements arrivent dans le tableau de bord Festival
- [ ] Auditer `inventory/push` et `push-product` (REST `inventory_levels/set.json` 2024-01)
- [ ] BATCH-0007 : ⋮ → Rafraîchir métachamps (96 items manquants) — encore d'actualité ?
- [ ] `pnpm lint` cassé : `next lint` n'existe plus en Next 16, migrer vers eslint

## Mémoire

Stocks resaisis à la main sur l'emplacement **Uriel Boxer** le 2026-08-22.

2026-08-23 — `/api/pos/stock/adjust` appelait encore la REST `inventory_levels/adjust.json`
(dépréciée, 404) : toute vente au stand sur une variante Shopify active décrémentait Ivy
sans toucher Shopify, sans même logger le mouvement. Passé en GraphQL
`inventoryAdjustQuantities` (`reason: correction`), + check `shopify_active`, + Shopify avant
le local, + les lignes en échec restent au panier en rouge, + le mode retour bascule le panier
déjà saisi. **Validé en production par Uriel.** v0.5.105 → **v0.5.108**.

`/ivy/hub` est le SEUL écran qui écrit du stock au stand (`/ivy/stand` = stats et zones).

Le vault Ivy (`~/ivy-vault/`) porte les gotchas et le log ; `_Inbox/` est vide.
