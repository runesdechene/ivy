# Déclarations douanières suisses (1187 / 11.74) — Design Spec

**Date :** 2026-08-23
**Statut :** approved (brainstorming validé avec Uriel)
**Branche :** `feat/douane-suisse`
**Contrainte :** festival suisse dans 3 jours — la phase 1 (aller) est prioritaire absolue

## Objectif

Depuis la page inventaire, préparer un **passage en douane suisse** : figer l'état du
stock d'un emplacement à l'instant du clic, produire le document d'importation
temporaire (formulaire **1187**, « pour vente incertaine sur festival »), puis au retour
produire le **11.74** et la réconciliation entre ce qui est parti, ce qui a été vendu et
ce qui revient.

## Le concept central : le passage

Une déclaration n'est **pas** « un aller » ou « un retour ». C'est un **passage**, qui
porte deux instantanés :

- **Instantané de départ** — figé au clic. Rien ne le modifie ensuite, même si le stock
  bouge, même si une variante disparaît.
- **Instantané de retour** — figé au clic, à la clôture du passage.

L'utilisateur ne choisit jamais un sens. Il crée un passage, ou il clôture celui qui est
ouvert. Le retour est donc **structurellement rattaché au bon départ**.

États : `open` (aller fait, retour attendu) → `closed` (retour fait).

## Périmètre

**Phase 1 — l'aller (avant le départ) :**
- Migration `product_variants.weight_grams` + alimentation par la sync Shopify.
- Tables `customs_declarations` et `customs_declaration_items`.
- Module de calcul partagé qui rejoue une règle de prix pour décomposer textile / impression.
- Écran de contrôle avant départ, avec correction du poids en place (poussée vers Shopify).
- Génération du passage (instantané figé) + PDF : feuille de résumé + une feuille par produit.

**Phase 2 — le retour (pendant que le stock est en Suisse) :**
- Instantané de retour, réconciliation à trois chiffres, PDF 11.74.

**Hors périmètre :**
- Remplissage automatique du formulaire officiel suisse (Ivy produit l'annexe, pas le
  formulaire lui-même).
- Autres pays que la Suisse.
- Correction en place du prix de vente ou des coûts (décision : seul le poids est
  éditable ; une règle manquante renvoie vers l'écran Règles de prix).
- Édition d'un passage clôturé.

## Décisions actées

| Sujet | Décision |
|---|---|
| Mémoire | Ivy fige un instantané par passage. Pas d'export à la volée. |
| Poids unitaire | Vient de Shopify via la sync (`variant.grams`, REST `products.json`). |
| Coût d'impression | Rejouer la règle de prix : textile = `base_price`, impression = majorations métachamp. |
| Format de sortie | PDF imprimable. |
| Taux EUR → CHF | Saisi à la main à la création du passage, figé dans l'instantané. |
| Poids brut | Saisi à la main (caisses pesées avant départ). |
| Structure du PDF | 1 feuille de résumé + 1 feuille par produit. Variantes à quantité 0 exclues. |
| Données manquantes | Blocage dur, levable par une dérogation explicite qui marque les lignes. |
| Correction en place | Le poids uniquement (→ Shopify). Règle manquante → lien vers l'écran dédié. |

## Le piège du coût : pourquoi on ne peut pas utiliser `cost` tel quel

`apply-ivy-stream` écrit `base_price + majorations métachamp + majorations d'option` dans
`product_variants.cost`. **Le `cost` contient donc déjà l'impression.** Additionner
`cost` et le coût d'impression compterait l'impression deux fois — et produirait une
déclaration douanière fausse.

Décomposition retenue :

- **Coût textile HT** = `price_rules.base_price` (+ majorations d'option, qui portent sur
  le textile : surcoût XXL, etc.)
- **Coût impression HT** = somme des `price_rule_modifiers` déclenchés par le métachamp
  d'impression (`DTG-CUI`, `DTG-PAR`…)
- **Total de contrôle** = textile + impression, qui **doit** retomber sur
  `product_variants.cost`. Sinon la ligne est signalée — jamais silencieusement corrigée.

## Modèle de données

### Migration `050_variant_weight.sql`

```sql
ALTER TABLE product_variants
ADD COLUMN IF NOT EXISTS weight_grams INTEGER;

COMMENT ON COLUMN product_variants.weight_grams IS
  'Poids unitaire en grammes, synchronisé depuis Shopify (variant.grams).';
```

`NULL` = poids inconnu, à distinguer d'un vrai zéro. C'est ce `NULL` qui déclenche le
blocage dans l'écran de contrôle.

### Migration `051_customs_declarations.sql`

```sql
CREATE TABLE customs_declarations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id),

  status TEXT NOT NULL DEFAULT 'open',        -- open | closed
  reference TEXT,                              -- n° 1187 saisi par l'utilisateur

  -- Figés à la création (aller)
  departed_on DATE NOT NULL,
  eur_to_chf DECIMAL(10, 5) NOT NULL,
  gross_weight_kg DECIMAL(10, 3),
  departure_snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Figés à la clôture (retour)
  returned_on DATE,
  return_snapshot_at TIMESTAMPTZ,

  -- Trace d'une génération forcée malgré des données manquantes
  forced BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE customs_declaration_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_id UUID NOT NULL REFERENCES customs_declarations(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,

  -- Libellés recopiés : la déclaration doit rester lisible même si le produit
  -- est supprimé ou renommé après coup.
  product_title TEXT NOT NULL,
  product_type TEXT,
  image_url TEXT,
  variant_title TEXT,
  size TEXT,
  color TEXT,

  qty_departed INTEGER NOT NULL,
  qty_returned INTEGER,                        -- rempli à la clôture
  qty_sold_recorded INTEGER,                   -- depuis stock_movements, à la clôture

  weight_grams INTEGER,
  unit_cost_textile DECIMAL(10, 2),
  unit_cost_print DECIMAL(10, 2),
  unit_customs_value DECIMAL(10, 2),           -- prix de vente
  origin TEXT NOT NULL DEFAULT 'BD',

  incomplete BOOLEAN NOT NULL DEFAULT FALSE,   -- ligne partie malgré une donnée manquante
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Les montants sont stockés **en euros**. Le CHF se recalcule à l'affichage avec le
`eur_to_chf` figé du passage — un seul taux, une seule source, pas de dérive d'arrondi
en base.

RLS identique aux autres tables du projet : lecture/écriture pour les membres du shop via
`user_shops`.

Un index unique partiel garantit qu'un emplacement n'a qu'un passage ouvert :

```sql
CREATE UNIQUE INDEX idx_customs_one_open_per_location
  ON customs_declarations(location_id) WHERE status = 'open';
```

## Le module de calcul

`src/lib/customs/pricing.ts`

```ts
export interface CostBreakdown {
  textile: number | null;   // base_price + majorations d'option
  print: number | null;     // majorations métachamp d'impression
  total: number | null;
  matchedRuleSku: string | null;
  /** Le total ne retombe pas sur product_variants.cost */
  mismatch: boolean;
  recordedCost: number;
}

export function resolveCostBreakdown(variant, rules, variantMetafields, metafieldConfigs): CostBreakdown
```

La logique de matching (préfixe SKU, `product_type`, résolution `namespace.key` →
`display_name` via `metafield_config`, majorations d'option depuis le `variant_title`)
est **extraite de `apply-ivy-stream`**, qui la duplique aujourd'hui avec trois autres
routes `apply-*`. On extrait sans toucher aux routes existantes : elles marchent, on ne
les casse pas à 3 jours d'un festival. Leur migration vers le module partagé est une
tâche de nettoyage ultérieure.

Pas de règle correspondante → `textile`, `print` et `total` à `null`, pas de zéro
trompeur.

## L'écran de contrôle avant départ

Quatre familles de problèmes, dans cet ordre :

| Sévérité | Problème | Correction |
|---|---|---|
| Bloquant | Poids `NULL` | Saisie en place → Shopify puis Ivy |
| Bloquant | Aucune règle de prix ne couvre la variante | Lien vers `/parametres/prix` |
| Signalé | `textile + impression ≠ cost` | Lien vers `/parametres/prix` |
| Signalé | Prix de vente à 0 (pas de valeur douanière) | Lien vers la fiche produit |

Le bouton **Générer** est désactivé tant qu'il reste un bloquant. Une case à cocher
« Partir quand même » le débloque : la déclaration est alors créée avec `forced = true`,
et chaque ligne concernée porte `incomplete = true` et **apparaît marquée sur le PDF**.

### Correction du poids

`PATCH /api/inventory/variants/[id]/weight` — même discipline que `/api/pos/stock/adjust` :

1. Si `inventory_item_id` présent **et** `shopify_active !== false` → GraphQL
   `inventoryItemUpdate` (API 2026-01) avec `measurement.weight`. **Pas** la REST
   `variants.json`, dépréciée comme l'était `inventory_levels/adjust.json`.
2. Shopify d'abord, Ivy ensuite. Si Shopify refuse, `weight_grams` ne bouge pas et
   l'erreur est affichée.
3. Variante purement locale → écriture Ivy seulement, sans appel Shopify.

## Les écrans

**Menu Exporter** (`/ivy/inventaire`) : une entrée « Douane suisse ».

**`/ivy/inventaire/douane`** — liste des passages. Chaque passage ouvert affiche son
emplacement, sa date de départ et un bouton « Générer le retour ». Un bouton
« Nouveau passage » en tête.

**Création** : emplacement, date, taux EUR → CHF, poids brut total, référence 1187
optionnelle. Validation → écran de contrôle → génération.

**`/ivy/inventaire/douane/[id]`** — le passage : le résumé, la liste par produit, un
bouton Imprimer. En phase 2, le bloc de réconciliation.

## Le PDF

`src/utils/customs-pdf.ts`, sur le modèle de `pdf-export.ts` (impression navigateur).

**Feuille 1 — résumé.** En tête, les totaux du passage : nombre de pièces, poids net,
poids brut, valeur douanière en CHF et en EUR, taux appliqué, date, emplacement,
référence 1187. Puis un tableau par type de produit : quantité, poids net, poids brut,
valeur douanière CHF, valeur douanière EUR — plus, en phase 2, quantité restante,
quantité vendue, poids restant, poids vendu, valeur restante, valeur vendue.

**Feuilles suivantes — une par produit.** Titre du produit, puis ses variantes de
quantité > 0, et un sous-total de feuille.

Colonnes de la liste :

| Colonne | Source |
|---|---|
| Type | `product_type` |
| Image | `image_url` |
| Référence | `product_title` |
| Taille / Couleur | options de la variante |
| Quantité à apporter | `qty_departed` |
| Vendu | **colonne vide, remplie à la main au festival** |
| Poids unitaire (kg) | `weight_grams / 1000` |
| Coût unitaire textile HT | `unit_cost_textile` |
| Coût unitaire impression HT | `unit_cost_print` |
| Valeur totale | `qty × (textile + impression)` |
| Textile CHF / Impression CHF / Valeur unitaire CHF | les mêmes × `eur_to_chf` |
| Valeur douanière | `unit_customs_value` (prix de vente) |
| Origine | `BD` |

## Le retour et la réconciliation (phase 2)

À la clôture, Ivy fige `qty_returned` depuis le stock de l'emplacement, et
`qty_sold_recorded` depuis la somme des `stock_movements` négatifs de cet emplacement
entre `departed_on` et `returned_on`.

Trois chiffres par ligne, et **l'écart affiché** :

```
parti − revenu  =  ce qui a physiquement quitté le stock
qty_sold_recorded =  ce qui a été enregistré comme vendu au stand
```

Quand `parti − revenu ≠ vendu`, la ligne est signalée. L'écart est réel sur un festival
(casse, cadeau, pièce oubliée) : le but n'est pas de le masquer mais de le connaître
avant qu'un douanier le demande. L'écart peut être négatif si un réapprovisionnement a eu
lieu pendant le festival ; le calcul le gère dans les deux sens.

**Contrainte d'usage :** l'instantané de retour doit être pris **avant** tout transfert de
rapatriement, sinon l'emplacement est déjà vide. L'écran affiche un avertissement
explicite, et Ivy détecte un transfert survenu depuis `departed_on` sur cet emplacement
pour le signaler.

## Ordre de livraison

1. **Migration poids + sync** — en premier, pour qu'Uriel puisse vérifier ses poids dès ce
   soir. C'est le risque le plus bloquant.
2. Tables du passage + module de calcul.
3. Écran de contrôle + correction du poids.
4. Génération du passage + PDF de l'aller.
5. *(après le départ)* Retour, réconciliation, PDF 11.74.

## Risques

**Poids absents dans Shopify — mesuré le 2026-08-23, pas supposé.**

Sur l'ensemble du catalogue : 4 502 variantes sur 4 910 ont un poids (92 %). Les 408
manquantes sont concentrées sur **« Le Zippé »** (324 sur 804), plus « L'Essentiel » (0/30)
et « Invisible » (0/28).

Sur **Uriel (Boxer)**, l'emplacement du festival : 489 lignes, 1 070 pièces, dont
**116 pièces sans poids (11 %)**, réparties en deux causes distinctes :

| Pièces | Cause | Conséquence |
|---|---|---|
| 96 | Variantes `shopify_active = false` — supprimées de Shopify, stock gardé dans Ivy | Le poids **ne peut pas** venir de Shopify ni y être poussé. Saisie locale obligatoire. |
| 20 | Vestes zippées (Hoplite, Avalon, Hécate, Skjaldmö) sans `grams` sur Shopify | Corrigeable dans Shopify, ou en place depuis l'écran de contrôle. |

Aucune variante purement locale (`shopify_id IS NULL`) en stock à cet emplacement.

Conséquences sur le design — toutes déjà couvertes, mais à ne pas perdre de vue :

1. L'écran de contrôle doit **distinguer les deux cas** : « corrigeable dans Shopify » et
   « saisie locale uniquement ». Pousser vers Shopify une variante `shopify_active=false`
   échouerait avec « inventory item could not be found ».
2. `weight_grams` doit donc être une colonne Ivy **autonome**, pas un simple miroir de
   Shopify : pour ces 96 pièces, Ivy est la seule source possible.
3. La sync ne doit **jamais écraser** un `weight_grams` saisi à la main par un zéro venu de
   Shopify. Règle : la sync ne remplit que si Shopify renvoie une valeur > 0.

**Vérifier aussi le prix de vente et le coût de ces 96 variantes supprimées** — si elles
n'ont plus de prix, elles n'ont pas de valeur douanière, et le blocage se déclenchera.

**Variantes hors règle de prix.** Impossible de décomposer textile / impression. Elles
sont listées à part et bloquent, plutôt que de sortir un chiffre inventé.

**Le PDF est une annexe, pas le formulaire.** Ivy ne remplit pas le 1187 officiel. Si la
douane exige un gabarit précis, il faudra adapter la mise en page — à valider avec le
document sous les yeux.
