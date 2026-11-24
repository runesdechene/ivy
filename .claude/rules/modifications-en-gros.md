# Modifier en gros : mockups, métachamps, profils de tailles

Quand Uriel demande une modification sur beaucoup de produits, passer **par les routes d'IVY**, jamais
directement par l'API Shopify : elles valident les valeurs, filtrent par boutique et gardent la base à jour.

## Accès

- Serveur : `pnpm dev` (local) — ou `IVY_URL=https://ivy.runesdechene.com` si la clé y est déployée.
- Header `x-ivy-automate: <MOCKUPS_CLE_AUTOMATE>` et `shopId=<MOCKUPS_SHOP_ID>`, tous deux dans `.env.local`.
- Scripts temporaires dans le scratchpad, en `fetch` node (pas de `/tmp` sous Windows).

## Routes

| But | Route |
|-----|-------|
| Lire recto / verso / tailles, par produit × couleur | `GET /api/mockups/metachamps?shopId` → `lignes[]` (`titre`, `modele`, `couleur`, `variantes[{id,taille}]`, `recto`, `verso`, `tailles`) |
| Écrire des métachamps | `POST /api/mockups/metachamps` `{shopId, ecritures:[{variantId, cle:'recto'\|'verso'\|'taille', valeur}]}` — **200 max par requête**, découper |
| Profils de tailles | `GET/POST/DELETE /api/mockups/profils` (`DELETE ?shopId&id`) |
| Générer / envoyer les mockups | `pnpm mockups "<produit>" \| <motif> [--envoyer]` |
| Trouver les produits d'un motif | `GET /api/mockups/produit?shopId&recherche=<Motif>` → `produits[{id,title}]` (actifs dans IVY) |
| Lire une fiche Shopify | `GET /api/mockups/fiche?shopId&productId` → `titre`, `handle`, `statut`, `tags`, `seo`, `champs[{cle,type,valeur}]` (métachamps `custom` : `illustrateur`, `illustration_produit`…) |
| Écrire une fiche | `PATCH /api/mockups/fiche` `{shopId, productId, titre?, statut?, tags?, seoDescription?, champs?:{cle: valeur\|null}}` → la fiche relue. Statut : ACTIVE, UNLISTED, DRAFT, ARCHIVED (ACTIVE = mise en vente : accord d'Uriel). Clé sans définition Shopify refusée ; `null` efface |

## Méthode

1. **Lire** l'état (`GET metachamps`), le sauver dans le scratchpad.
2. **Calculer seulement les écritures qui changent quelque chose** (comparer en majuscules : Shopify écrit `D-Max`, IVY `D-MAX`), et lister les produits touchés.
3. **Montrer le compte à Uriel avant d'écrire** si ce n'est pas déjà validé : c'est la boutique en production.
4. **Écrire** par paquets, puis **relire** (`GET` à nouveau) pour vérifier.
5. Noter la décision dans le `_État.md` d'IVY (Tranché).

Fiches produits et stocks : **tout passe par IVY** (Uriel, 24/11/2026), avec ses droits Shopify (`productUpdate`, `publishablePublish`…). Protocole d'un motif : `Savoir-faire/Nouveau motif.md` du vault.
