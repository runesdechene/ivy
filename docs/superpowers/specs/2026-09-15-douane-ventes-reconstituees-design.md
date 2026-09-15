# Ventes reconstituées et synthèse du 11.87 — Design Spec

**Date :** 2026-09-15
**Statut :** approuvé (Uriel, 2026-09-15)
**Branche :** `feat/douane-ventes`
**Contrainte :** livré avant le départ du 2026-09-16 (réseau incertain pendant le festival). Rien n'est fusionné dans `main` tant que ce n'est pas vérifié.

## Objectif

Au retour d'un festival, reconstituer une **liste de ventes par produit**, cohérente au centime avec
le **rapport SumUp** et les **espèces**, pour la déclaration WebDec. Refaire la **synthèse du 11.87** pour
qu'elle s'appuie sur cette liste, avec la TVA calculée comme la douane.

Ivy n'est pas une caisse (NF525) : rien n'est écrit dans le stock ni dans `stock_movements`. La
reconstitution est un **document attaché au passage clôturé**.

## Faits établis (voir la conversation du 2026-09-14/15)

- SumUp encaisse **toujours en euros**. CA déclaré = total SumUp (EUR) × **taux du passage**
  (Fribourg : 5 331,95 € × 0,94 = 5 012,03 CHF, déclaré 5 012 sur WebDec).
- Le rapport SumUp (`.xlsx`) donne **une ligne par paiement** (date, heure, montant, réf.), sans article
  (« Montant personnalisé ») et sans réduction. Une transaction peut avoir plusieurs lignes.
- Prix affichés au stand en **CHF ronds**. Un paiement carte est reconverti par SumUp en euros ; un
  paiement **rond en euros** est un client payé en euros **au pair** (1 CHF = 1 €, usage frontalier).
- La TVA suisse est **ajoutée par-dessus** le CA déclaré — règle suisse de la contre-prestation,
  **confirmée par Uriel le 2026-09-15** : 5 012 × 8,1 % = 405,97 → **405,95** payés (arrondi aux 5 centimes).
- Quantité vendue = **parti − revenu par type** (Fribourg : 125, et non 126 : un t-shirt rapporté par
  une cliente).

## Règles de la reconstitution (validées par Uriel)

1. Chaque pièce vendue est placée **une seule fois**, dans un paiement.
2. Prix d'une pièce **≤ prix affiché** du type ; **≥ prix minimal** du type ; sinon la pièce est **offerte** (prix 0).
3. Remises par **tranches de 5 CHF** ; un paiement dont le montant n'est pas multiple de 5 laisse un
   seul prix non rond.
4. Dans un panier, la remise est répartie **en pourcentage** (la pièce la moins remisée baisse d'abord).
5. Un achat d'une seule pièce au prix affiché reste tel quel ; les pièces en trop vont dans les paniers
   de plusieurs pièces (lots).
6. **Aucune date de mouvement de stock** n'est utilisée : chaque panier est un paiement SumUp (même date,
   heure, montant), ce qui garantit la cohérence avec le fichier d'origine.
7. Totaux **exacts au centime** : liste = synthèse = SumUp × taux + espèces.

## Données

### Référentiel — migration `063`

`customs_type_tariffs` : `prix_affiche_chf DECIMAL(10,2)`, `prix_minimal_chf DECIMAL(10,2)`
(nullables ; contrôle `prix_minimal_chf <= prix_affiche_chf`). Amorce : Le Confort 50/20,
Débardeurs 40/15, Le Moelleux 90/70, Le Zippé 110/80, L'Éternel —/80 (prix affiché à saisir).

### Passage — migration `063`

`customs_declarations.reconstitution JSONB` (nullable) :

```json
{
  "genere_le": "2026-09-15T12:00:00Z",
  "entrees": {
    "taux": 0.94, "taux_sumup": 0.93773,
    "especes_chf": 0, "especes_eur": 0,
    "prix": { "Le Confort": { "affiche": 50, "minimal": 20 } },
    "paiements": [{ "ref": "TAAA42B4S7T", "date": "2026-08-27T18:07", "eur": 53.32 }]
  },
  "paiements": [{
    "source": "sumup" | "especes", "ref": "…", "date": "…", "devise": "EUR" | "CHF",
    "montant": 53.32, "stand_chf": 50, "declare_centimes": 5012,
    "lignes": [{ "type": "Le Confort", "piece": "Avalon Blanc S", "prix_stand": 50, "declare_centimes": 5012, "offerte": false }]
  }],
  "avertissements": ["…"]
}
```

Les entrées sont **figées** avec le résultat : la liste reste identique même si le référentiel change.

## Modules

- `src/lib/customs/sumup.ts` — lecture du rapport `.xlsx` SumUp (zip + XML, sans dépendance) → paiements
  regroupés par référence, ventes moins remboursements.
- `src/lib/customs/reconstitution.ts` — algorithme pur : pièces vendues, paiements, espèces, prix,
  taux → résultat ci-dessus, ou erreur explicite.
- Estimation du **taux SumUp implicite** : le taux dans [0,90 ; 1,00] (pas 0,0001) qui ramène le plus de
  paiements non ronds en euros sur un franc rond ; paiements ronds en euros lus au pair.

### Espèces

Montant « stand » = CHF + EUR (au pair) ; montant déclaré = CHF + EUR × taux. Après les paniers SumUp,
les pièces restantes forment des **paiements « Espèces — reconstitués »** : paniers de 1 à 3 pièces,
montants par tranches de 5 CHF, le dernier absorbe le reste. Si les planchers des pièces restantes
dépassent les espèces, des pièces passent d'abord dans les lots SumUp ; si le catalogue restant est
inférieur aux espèces, erreur explicite.

### Erreurs explicites (rien de faux n'est produit)

- Encaissé (stand) supérieur au catalogue des pièces vendues → prix affichés trop bas ou pièces manquantes.
- Un paiement ne peut être couvert par aucun panier dans les règles.
- Prix affiché ou minimal manquant pour un type vendu.
- Passage non clôturé.

## Écrans

**Paramètres → Douane** : colonnes « Prix affiché (CHF) » et « Prix minimal (CHF) » dans le référentiel.

**Passage clôturé** : cadre « Ventes reconstituées » — import du `.xlsx`, espèces CHF et EUR,
bouton « Reconstituer » ; affiche les avertissements, les totaux par type, et deux boutons
d'impression (liste des ventes, synthèse).

## Documents

**Liste des ventes** (`/api/customs/passages/[id]/ventes`) : une ligne par paiement — date, source,
montant d'origine, montant déclaré CHF, panier (quantité × type au prix stand, offertes). Ligne TOTAL.

**Synthèse du 11.87** (`document`, passage clôturé) — colonnes Retour par type :
Qté restante · Qté sortie · dont offertes · Poids restant · Valeur restante · **CA déclaré (CHF)** ·
**TVA 8,1 %**. Ligne TOTAL : sommes, et **TVA à payer arrondie aux 5 centimes**. Sans reconstitution,
les colonnes CA/TVA restent vides « à compléter ». Supprimés : prix moyen, base HT extraite, CA
théorique (`prices_chf_ttc`), mentions « caisse » (remplacées par « mouvements de stock »).

## Vérification

- `sumup.ts` sur les deux rapports du bureau : 88 paiements / 4 539 € et 61 paiements / 5 331,95 €.
- `reconstitution.ts` sur les données d'août : 125 pièces, 5 012,03 CHF, planchers respectés,
  répartition identique au prototype `repartition_v4`.
- Cas espèces (CHF + EUR), cas impossibles (encaissé > catalogue, planchers trop hauts), cadeaux.
- Feuille du 11.87 : chaque colonne se recalcule, TVA 405,95 pour août.
- Serveur de dev, `tsc`, `pnpm build`.

## Hors périmètre

- Remplissage de WebDec lui-même (guide WebDec : plus tard).
- Transactions SumUp remboursées partiellement au-delà d'une soustraction simple.
