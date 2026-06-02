# Comptes de stand (privé) — Design Spec

**Date :** 2026-06-02
**Statut :** en revue (brainstorming validé décision par décision)
**Branche :** `feat/comptes-de-stand`

## Objectif

Module privé dans IVY permettant à l'apprenti (qui tient seul les stands de festival de Runes de Chêne) de tenir, le soir après le festival, deux suivis financiers :

1. **Dépenses engagées** qu'il avance pour l'entreprise et doit se faire rembourser (note de frais).
2. **Suivi de son fond de caisse cash** : ce qu'il pioche dedans, pour piloter son solde de cash sur le stand.

Le module est rattaché aux pivots IVY existants (emplacement + festival) et conçu autour d'un **modèle de menace de sécurité défensive** explicite (vol physique sur stand, dump de base).

## Modèle de menace (raison d'être de la conception sécurité)

Le besoin de confidentialité n'est **pas** fiscal — l'argent est déclaré, aucune vente n'est enregistrée dans le système, l'État a déjà accès aux déclarations. Il est **défensif** :

- **Menace 1 — vol physique sur le stand (priorité haute).** Sur le stand, un tiers pourrait voir l'écran par-dessus l'épaule, ou s'emparer du téléphone, et apprendre combien de cash l'apprenti transporte sur lui → risque d'agression / vol ciblé. La page ne doit donc jamais exposer de sommes « en un clic ».
- **Menace 2 — dump / scan de la base.** Un attaquant qui accéderait à la base ne doit pas pouvoir tracer trivialement les finances via une API publique ou la clé anon.

Ces deux menaces dictent les choix de la section **Sécurité**.

## Périmètre

**In-scope :**
- Nouveau module privé sous la section **Festivals** : route `/ivy/stand/comptes`, **non listée dans la navigation principale**.
- Point d'entrée discret sur le **tableau de bord Festivals** (icône cadenas discrète) qui ouvre le **gate PIN** ; pas de libellé « caisse / argent » visible. *(NB : les routes API restent sous `/api/hub/comptes/*`, chemin interne inchangé.)*
- **Verrou d'accès double** :
  - Côté serveur/données : RLS par appartenance au shop (`user_shops`). Aujourd'hui un **seul compte** IVY → c'est lui, et lui seul. (Allowlist multi-comptes = post-MVP, voir out-of-scope.)
  - Côté affichage/stand : **gate PIN** (4–6 chiffres) à l'ouverture + **montants masqués par défaut** (`••••`), révélés après PIN, re-masqués automatiquement.
- **PIN défini par l'utilisateur** via un **écran de première configuration** (le PIN ne transite ni par un tiers ni par un fichier). Stocké en **hash salé** (bcrypt/argon2id), jamais en clair, jamais réversible.
- **Tableau A — Dépenses engagées remboursables** : montant, date, description, photo du reçu, statut (`engagé` → `soumis` → `remboursé`), rattachement emplacement + festival.
- **Tableau B — Suivi de caisse cash** : fond de caisse d'ouverture par festival + sorties piochées (montant, date, description). **Solde = ouverture − Σ sorties**, déduit. Aucun prix de vente / encaissement enregistré.
- Upload **photo du reçu** depuis le téléphone → Supabase Storage (bucket privé), URL signée à la demande.
- Réutilisation des pivots existants : `locations` (emplacement) et `pos_study_zones` (festival).
- UI pensée **mobile-first / PWA**, saisie le soir en wifi (pas d'offline-first temps réel requis).
- Routes serveur (`/api/hub/comptes/*`) en `service_role` ; les nouvelles tables ne sont **jamais** lues via la clé anon côté client.

**Out-of-scope (post-MVP / YAGNI) :**
- Catégories de dépenses (volontairement écarté).
- Enregistrement des **ventes / encaissements** (hors périmètre NF525 — jamais dans IVY).
- Chiffrement applicatif des champs (décision : RLS + `service_role` suffisent ; arbitrage tracé plus bas).
- Biométrie / WebAuthn (PIN suffit pour le MVP).
- **Allowlist multi-comptes** (`hub_ledger_authorized_users`) : reportée jusqu'à ce que l'apprenti ait son propre compte IVY. Aujourd'hui compte unique → l'accès données = appartenance shop.
- Export PDF/CSV de note de frais, relances de remboursement, multi-devises.
- Offline-first / synchronisation conflictuelle.
- Rapprochement automatique caisse ↔ ventes POS d'IVY.

## Décisions & arbitrages (tracés)

| Décision | Choix retenu | Raison |
|---|---|---|
| Modèle de données | **3 tables dédiées** (vs 1 table `ledger` fourre-tout) | Champs propres par tableau, pas de colonnes nullables, requêtes simples. |
| Emplacement de la page | **Page privée sous la section Festivals** (`/ivy/stand/comptes`), hors nav principale | Conforme au besoin « pas cliquable facilement au stand ». |
| Verrou stand | **PIN + masquage visuel** (pas biométrie) | Indépendant de l'appareil, simple, couvre la menace 1. |
| Sécurité DB | **RLS + `service_role` seul** (pas de chiffrement applicatif) | Suffisant contre exposition API ; le chiffrement casse les sommes SQL et ajoute une gestion de clé non justifiée pour le MVP. |
| Nommage tables | Préfixe neutre `hub_ledger_*` | Discrétion de schéma (défense-en-profondeur mineure). **Non** présenté comme sécurité réelle ; aucune obfuscation destinée à entraver un audit légitime. Données sincères et intègres. |
| Accès données | Appartenance shop (`user_shops`), **compte unique** aujourd'hui | YAGNI : pas d'allowlist tant qu'il n'y a qu'un compte. |
| Stockage PIN | **Hash salé** (bcrypt/argon2id), pas de chiffrement réversible | Un dump de base ne révèle jamais le PIN. |
| Pose du PIN | **Écran de 1ère config**, défini par l'utilisateur | Le PIN ne transite par aucun tiers ni fichier ni chat. |

## Modèle de données

Nouvelle migration `supabase/migrations/0XX_hub_ledger.sql` (numéro = suivant disponible, à figer à l'implémentation).

### `hub_ledger_settings` — réglages du module (1 ligne par shop)
| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `shop_id` | UUID FK → `shops(id)` UNIQUE | tenant |
| `pin_hash` | TEXT nullable | hash salé du PIN (bcrypt/argon2id). `NULL` = PIN pas encore défini → déclenche l'écran de 1ère config. |
| `pin_set_at` | TIMESTAMPTZ nullable | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

> Le PIN n'est **jamais** stocké ni transmis en clair. La route `unlock` reçoit le PIN saisi, le compare au hash côté serveur, et renvoie un jeton de déverrouillage à courte durée. La pose initiale passe par l'écran de 1ère config (`POST` qui hash et stocke).

### `hub_ledger_expenses` — Tableau A (dépenses remboursables)
| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `shop_id` | UUID FK → `shops(id)` | tenant |
| `location_id` | UUID FK → `locations(id)` nullable | emplacement |
| `study_zone_id` | UUID FK → `pos_study_zones(id)` nullable | festival |
| `spent_on` | DATE | date de la dépense |
| `description` | TEXT | |
| `amount` | DECIMAL(10,2) | montant engagé |
| `receipt_path` | TEXT nullable | chemin objet Storage (bucket privé) |
| `status` | TEXT | `engage` \| `soumis` \| `rembourse` (default `engage`) |
| `created_by_user_id` | UUID | `auth.uid()` à l'insertion |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

### `hub_ledger_cash_sessions` — fond de caisse par festival (Tableau B, en-tête)
| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `shop_id` | UUID FK → `shops(id)` | tenant |
| `location_id` | UUID FK → `locations(id)` nullable | emplacement |
| `study_zone_id` | UUID FK → `pos_study_zones(id)` nullable | festival |
| `opening_float` | DECIMAL(10,2) | fond de caisse d'ouverture |
| `opened_on` | DATE | |
| `created_by_user_id` | UUID | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

### `hub_ledger_cash_outflows` — sorties piochées (Tableau B, lignes)
| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `session_id` | UUID FK → `hub_ledger_cash_sessions(id)` ON DELETE CASCADE | |
| `spent_on` | DATE | |
| `description` | TEXT | |
| `amount` | DECIMAL(10,2) | sortie cash |
| `created_by_user_id` | UUID | |
| `created_at` | TIMESTAMPTZ | |

**Solde caisse** (calculé, pas stocké) = `opening_float − Σ amount des outflows` de la session.

### RLS (toutes les tables `hub_ledger_*`)
- `ENABLE ROW LEVEL SECURITY`.
- Policy SELECT/INSERT/UPDATE/DELETE conditionnée à l'appartenance au shop, pattern IVY existant :
  `EXISTS (SELECT 1 FROM user_shops us WHERE us.shop_id = <row>.shop_id AND us.user_id = auth.uid())`.
- Compte unique aujourd'hui → seul ce compte accède. (Si un 2e compte arrive, restreindre via l'allowlist post-MVP.)
- Les routes serveur passent en `service_role` (RLS bypassée côté API) mais **revérifient l'appartenance shop applicativement** avant toute lecture/écriture, et exigent un **jeton de déverrouillage PIN valide** pour servir des montants.

### Storage
- Bucket privé `hub-receipts` (non public).
- Upload via route serveur ; lecture via **URL signée** courte durée, jamais d'URL publique.

## Architecture applicative

### Route & layout
- `src/app/ivy/stand/comptes/page.tsx` — page du module (client component).
- Gate PIN rendu avant le contenu : tant que non déverrouillé → composant `<PinGate />`, aucun appel de données.
- Le tableau de bord Festivals (`src/app/ivy/stand/page.tsx`) reçoit une **icône cadenas discrète** → `Link` vers `/ivy/stand/comptes`. Pas d'entrée dans `IvyLayout`/`TopNavbar`.

### Composants (nouveaux, dossier `src/app/ivy/stand/comptes/components/`)
- `PinSetup.tsx` — **écran de 1ère config** : affiché quand `pin_hash IS NULL`. Saisie + confirmation du PIN, envoi à la route de pose (qui hash côté serveur). Le PIN ne quitte pas l'appareil en clair au-delà de la requête HTTPS de pose.
- `PinGate.tsx` — saisie PIN, déverrouillage (jeton à courte durée en `sessionStorage`), bouton verrouiller.
- `MaskedAmount.tsx` — affiche `••••` par défaut, révèle au déverrouillage, re-masque sur `visibilitychange` / timeout d'inactivité.
- `ExpensesTable.tsx` — Tableau A : liste, ajout/édition, upload reçu, changement de statut.
- `CashTable.tsx` — Tableau B : sélection festival, fond de caisse, liste des sorties, solde déduit.
- `ExpenseForm.tsx` / `CashOutflowForm.tsx` — formulaires Mantine, pensés mobile.

### Hooks
- `usePinLock.ts` — état verrouillé/déverrouillé, timeout, re-masquage.
- `useLedger.ts` — fetch/mutations via les routes serveur (TanStack Query, comme le reste d'IVY).

### Routes serveur (`src/app/api/hub/comptes/`)
- `expenses/route.ts` — GET (liste filtrée emplacement/festival), POST, PATCH (statut/champs), DELETE.
- `cash/sessions/route.ts` — GET/POST/PATCH (fond de caisse).
- `cash/outflows/route.ts` — GET/POST/DELETE.
- `receipts/route.ts` — POST upload (vers bucket privé), GET URL signée.
- `pin/route.ts` — `POST` pose initiale (hash + stocke si `pin_hash IS NULL`), `POST unlock` (compare hash, renvoie jeton court). Anti-bruteforce : délai/limitation des tentatives.
- Chaque route données : auth Supabase → vérif appartenance shop → **jeton PIN valide requis** → opération `service_role`. Refus 403 si non autorisé.

### Réutilisation existante
- `LocationContext` / `LocationSelector` pour l'emplacement courant.
- `pos_study_zones` via l'API existante `/api/pos/study-zones` pour la liste des festivals.
- `useShop` / `ShopContext` pour `shop_id`.
- Conventions IVY : pnpm, TS strict, `@/*`, Mantine 7, TanStack Query.

## User flow

1. Le soir, en wifi, l'apprenti ouvre IVY → Hub de stand.
2. Il tape l'icône cadenas discrète (tableau de bord Festivals) → `/ivy/stand/comptes`. **Au tout premier accès** (`pin_hash IS NULL`) : écran **PinSetup**, il définit son PIN lui-même. Ensuite : **PinGate**. Tout est masqué tant que le PIN n'est pas saisi.
3. PIN correct → jeton de déverrouillage court, la page se déverrouille, les montants se révèlent.
4. **Onglet Dépenses** : il ajoute une dépense (montant, date, description), prend/joint la **photo du reçu**, choisit l'emplacement + le festival, statut `engagé`.
5. **Onglet Caisse** : il sélectionne le festival, saisit (ou retrouve) le **fond de caisse d'ouverture**, ajoute ses **sorties** ; le **solde** s'affiche, déduit.
6. Inactivité / changement d'onglet → montants **re-masqués** automatiquement ; un bouton « verrouiller » re-arme le PIN.
7. Côté owner : même page (compte autorisé), il fait passer les dépenses `soumis` → `remboursé` pour suivre ce qu'il doit encore.

## Gestion d'erreurs
- Accès non autorisé (compte hors shop / sans jeton PIN) : route serveur renvoie **403**, l'UI affiche un écran neutre « accès restreint », aucune donnée.
- PIN erroné : message générique + limitation des tentatives (anti-bruteforce), pas de fuite.
- Upload reçu échoué : la dépense est enregistrée sans reçu, badge « reçu manquant », réessai possible.
- Montant invalide / négatif : validation côté formulaire + garde-fou serveur.
- Solde caisse négatif : autorisé mais signalé visuellement (alerte) — l'apprenti a pioché plus que le fond.

## Tests / vérification
- Pas de framework de tests dans IVY → **vérification manuelle via dev server** (`pnpm dev`), conforme aux conventions.
- Checklist manuelle : RLS (un compte hors shop ne voit rien, même requête directe via API), 1ère config pose le PIN (hash en base, jamais en clair), gate PIN bloque le rendu sans jeton valide, masquage/re-masquage, upload + URL signée, calcul du solde, statuts de remboursement, rendu mobile.

## Notes de conformité
- **NF525** : non concerné. Aucune vente / encaissement / prix de vente / remise n'est enregistré. Le suivi de caisse ne traque que le fond d'ouverture et les sorties (outil de gestion de fond de caisse), conformément à la règle d'or IVY « Ivy n'est PAS une caisse ».
- Données **sincères et intègres** : aucun mécanisme d'altération/suppression destiné à fausser un audit. Le nommage neutre relève de la discrétion de schéma, pas de la dissimulation.
