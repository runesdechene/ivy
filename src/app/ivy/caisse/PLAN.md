# Plan de développement - Section Caisse (POS)

## 🎯 Objectif

Créer un micro-logiciel de caisse rapide pour la vente sur stand, optimisé pour tablette en mode paysage et interface tactile.

---

## 📐 Architecture de l'interface

### Layout principal
```
┌─────────────────────────────────────────────────────────────┬──────────────────┐
│                                                             │                  │
│                    ZONE DE SÉLECTION                        │      PANIER      │
│                       (flex: 1)                             │   (width: 300px) │
│                                                             │                  │
│  [Type]      [Produit]     [Couleur]    [Taille]   [Opt3]   │  ┌────────────┐  │
│  ┌──────┐    ┌──────────┐  ┌─────────┐  ┌───────┐  ┌─────┐  │  │ Item 1  🗑 │  │
│  │T-shir│    │Dragon    │  │🔴 Rouge │  │  S    │  │Recto│  │  │ [-] 2 [+]  │  │
│  │Hoodie│    │Loup      │  │🔵 Bleu  │  │  M ●  │  │Verso│  │  ├────────────┤  │
│  │Sweat │    │Arbre ●   │  │⚫ Noir ●│  │  L    │  │     │  │  │ Item 2  🗑 │  │
│  │● Cap │    │Cerf      │  │⚠️ Blanc │  │  XL   │  │     │  │  │ [-] 1 [+]  │  │
│  └──────┘    └──────────┘  └─────────┘  └───────┘  └─────┘  │  ├────────────┤  │
│                                                             │  │            │  │
│  ● = sélectionné                                            │  │ TOTAL: 69€ │  │
│  ⚠️ = stock à 0 (sélectionnable avec avertissement)         │  │            │  │
│                                                             │  │[CONFIRMER] │  │
│                                                             │  └────────────┘  │
└─────────────────────────────────────────────────────────────┴──────────────────┘
```

### Particularités
- **Pas de menu contextuel gauche** (contrairement aux autres sections /ivy)
- **Interface tactile** : gros boutons, espacement généreux
- **Colonnes dynamiques** : s'affichent au fur et à mesure de la sélection

---

## 🔄 Flux de sélection (Entonnoir)

### Étapes
1. **Type de produit** (`product_type`) - Toujours visible
2. **Nom du produit** (`product.title`) - Apparaît après sélection du type
3. **Couleur** (`option1` généralement) - Apparaît après sélection du produit
4. **Taille** (`option2` généralement) - Apparaît après sélection de la couleur
5. **Option 3** (optionnel, ex: Recto/Verso) - Si applicable

### Comportement
- Cliquer sur une étape précédente réinitialise les étapes suivantes
- Stock à 0 → Afficher avec ⚠️, reste sélectionnable
- Sélection complète → Ajout automatique au panier (quantité 1)

---

## 🛒 Zone Panier

### Éléments
- **Header** : Titre "Panier" + bouton "Vider" (🗑)
- **Liste des items** :
  - Nom complet (Produit + options)
  - Prix unitaire
  - Contrôle quantité : `[-]` `quantité` `[+]`
  - Prix total ligne
  - Bouton supprimer (🗑)
- **Footer** :
  - Total général
  - Bouton "CONFIRMER" (pleine largeur)

### Quantités négatives (Remboursements)
- Permettre quantité négative via le bouton `[-]`
- Affichage différencié (couleur rouge, préfixe "-")
- Lors de la validation : incrémente le stock au lieu de décrémenter

---

## 💳 Modal de paiement

### Contenu
```
┌─────────────────────────────────────┐
│         CONFIRMER LA VENTE          │
├─────────────────────────────────────┤
│                                     │
│  Vendeur :  [Avatar] [Sélection ▼]  │
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  Articles : 3                       │
│  Total à encaisser : 69,00 €        │
│                                     │
│  (ou "Total à rembourser" si < 0)   │
│                                     │
├─────────────────────────────────────┤
│  [Annuler]      [Marquer comme payé]│
└─────────────────────────────────────┘
```

### Actions
- **Annuler** : Ferme la modal, conserve le panier
- **Marquer comme payé** :
  1. Enregistre la vente en DB
  2. Ajuste le stock local (Supabase)
  3. Synchronise avec Shopify (inventory_levels/adjust)
  4. Vide le panier
  5. Affiche notification de succès

---

## 🗄️ Structure Base de Données

### Tables à créer

```sql
-- Vendeurs du point de vente
CREATE TABLE pos_sellers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ventes (en-tête)
CREATE TABLE pos_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id),
  seller_id UUID REFERENCES pos_sellers(id),
  total_amount DECIMAL(10,2) NOT NULL,
  items_count INTEGER NOT NULL,
  is_refund BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by_user_id TEXT -- Firebase UID
);

-- Lignes de vente (détail)
CREATE TABLE pos_sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id),
  product_title VARCHAR(255) NOT NULL,
  variant_title VARCHAR(255),
  quantity INTEGER NOT NULL, -- Peut être négatif pour remboursement
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour les statistiques
CREATE INDEX idx_pos_sales_shop_date ON pos_sales(shop_id, created_at);
CREATE INDEX idx_pos_sales_seller ON pos_sales(seller_id);
CREATE INDEX idx_pos_sale_items_variant ON pos_sale_items(variant_id);
```

---

## 📁 Structure des fichiers

```
src/app/ivy/caisse/
├── PLAN.md                    # Ce fichier
├── page.tsx                   # Page principale (layout 2 zones)
├── layout.tsx                 # Layout sans menu latéral
├── components/
│   ├── SelectionZone.tsx      # Zone gauche (entonnoir)
│   ├── TypeColumn.tsx         # Colonne types de produits
│   ├── ProductColumn.tsx      # Colonne noms de produits
│   ├── OptionColumn.tsx       # Colonne générique pour options
│   ├── CartZone.tsx           # Zone panier (droite)
│   ├── CartItem.tsx           # Ligne d'item dans le panier
│   ├── PaymentModal.tsx       # Modal de confirmation
│   └── SellerSelect.tsx       # Sélecteur de vendeur avec avatar
├── hooks/
│   ├── useProductSelection.ts # État de l'entonnoir de sélection
│   └── useCart.ts             # État du panier
└── types.ts                   # Types TypeScript

src/app/api/pos/
├── sellers/
│   └── route.ts               # CRUD vendeurs
├── sales/
│   └── route.ts               # Créer une vente
└── stock/
    └── adjust/
        └── route.ts           # Ajuster stock local + Shopify
```

---

## 🔌 APIs à créer

### 1. GET/POST /api/pos/sellers
- Liste des vendeurs actifs
- Création d'un nouveau vendeur

### 2. POST /api/pos/sales
- Crée une vente avec ses lignes
- Retourne l'ID de la vente créée

### 3. POST /api/pos/stock/adjust
- Reçoit : `{ items: [{ variantId, quantity, locationId }] }`
- Ajuste le stock dans `inventory_levels` (Supabase)
- Appelle Shopify `POST /inventory_levels/adjust.json` pour chaque item
- Gère les erreurs partielles

---

## 📋 TODO - Ordre d'implémentation

### Phase 1 : Infrastructure
- [ ] Créer la migration SQL (tables pos_*)
- [ ] Créer le layout sans menu latéral
- [ ] Créer la page de base avec les 2 zones

### Phase 2 : Zone de Sélection
- [ ] Implémenter le hook useProductSelection
- [ ] Créer TypeColumn (liste des types depuis products)
- [ ] Créer ProductColumn (filtrée par type)
- [ ] Créer OptionColumn (générique, réutilisable)
- [ ] Gérer l'indicateur stock ⚠️

### Phase 3 : Zone Panier
- [ ] Implémenter le hook useCart
- [ ] Créer CartZone avec header/footer
- [ ] Créer CartItem avec contrôles quantité
- [ ] Gérer les quantités négatives (remboursements)
- [ ] Calculer les totaux

### Phase 4 : Paiement & Vendeurs
- [ ] API CRUD vendeurs
- [ ] Créer SellerSelect avec avatars
- [ ] Créer PaymentModal
- [ ] API création de vente

### Phase 5 : Synchronisation Stock
- [ ] API d'ajustement stock
- [ ] Intégration Shopify inventory_levels/adjust
- [ ] Gestion des erreurs et rollback

### Phase 6 : Polish
- [ ] Optimisation tactile (tailles, espacement)
- [ ] Feedback visuel (animations, notifications)
- [ ] Tests sur tablette réelle

---

## 🎨 Notes UX

- **Couleurs** : Utiliser les pastilles de couleur existantes (color-transformer)
- **Tailles boutons** : Minimum 44x44px pour le tactile
- **Feedback** : Animation légère à l'ajout au panier
- **Remboursement** : Fond rouge clair pour les lignes négatives
- **Confirmation** : Vibration/son optionnel sur validation

---

## 🏷️ Système de Remises Dynamiques

### Concept

Un moteur de règles combinatoires avec un mini-langage de logique permettant de définir des remises personnalisées.

### Types de remises supportés

1. **Global** : X% sur tout le panier
2. **Progressif par article** : 10% sur le 2e article (le moins cher), 20% sur le 3e, 30% sur le 4e...
3. **Progressif cumulé** : X% sur l'article le moins cher, où X augmente avec le nombre d'articles

### Structure de la règle

```typescript
interface DiscountRule {
  id: string;
  shop_id: string;
  name: string;           // "Promo Stand 3+1"
  description: string;    // Description lisible
  expression: string;     // Langage de logique
  priority: number;       // Ordre d'application
  is_active: boolean;
  created_at: Date;
}
```

### Mini-langage de logique

```
// Syntaxe : CONDITION -> ACTION

// Variables disponibles :
// - items_count : nombre d'articles dans le panier
// - items : liste des articles triés par prix
// - total : total du panier
// - item[n] : n-ième article (0 = le moins cher)

// Fonctions :
// - discount(target, percentage) : applique une remise
// - target: "all" | "cheapest" | "item[n]" | "items[n:m]"

// Exemples :

// Mode 1 : Global 15%
items_count >= 1 -> discount("all", 15)

// Mode 2 : Progressif par article
items_count >= 2 -> discount("item[0]", 10)
items_count >= 3 -> discount("item[1]", 20)
items_count >= 4 -> discount("item[2]", 30)

// Mode 3 : Progressif cumulé sur le moins cher
items_count == 2 -> discount("cheapest", 10)
items_count == 3 -> discount("cheapest", 20)
items_count >= 4 -> discount("cheapest", 30)

// Avancé : Remise si type spécifique
items_count >= 2 AND has_type("T-shirt") -> discount("cheapest", 15)

// Avancé : 2e article à -50% si même type
items_count >= 2 AND same_type(item[0], item[1]) -> discount("item[0]", 50)
```

### Table SQL

```sql
CREATE TABLE pos_discount_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  expression TEXT NOT NULL,        -- Le code de la règle
  priority INTEGER DEFAULT 0,      -- Plus haut = appliqué en premier
  is_active BOOLEAN DEFAULT true,
  is_combinable BOOLEAN DEFAULT true,  -- Peut se combiner avec d'autres
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ajout à pos_sales pour tracer la remise utilisée
ALTER TABLE pos_sales ADD COLUMN discount_rule_id UUID REFERENCES pos_discount_rules(id);
ALTER TABLE pos_sales ADD COLUMN discount_amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE pos_sales ADD COLUMN subtotal DECIMAL(10,2); -- Avant remise
```

### Interface dans le Panier

```
┌─────────────────────────┐
│ 🛒 Panier        [🗑]   │
├─────────────────────────┤
│ T-shirt Dragon M        │
│ 24,00€           [-][+] │
├─────────────────────────┤
│ Hoodie Loup L           │
│ 45,00€  -10% → 40,50€   │  ← Remise visible
├─────────────────────────┤
│                         │
│ Sous-total:     69,00€  │
│ Remise (-10%):  -4,50€  │
│ ─────────────────────── │
│ TOTAL:          64,50€  │
│                         │
│ [🏷️ Promo Stand] [ON]   │  ← Toggle remise + mémoire
│                         │
│ [    CONFIRMER    ]     │
└─────────────────────────┘
```

### Comportement du Toggle Remise

- **Bouton toggle** : Active/désactive les remises pour cette vente
- **Mémoire** : Garde en mémoire la dernière règle utilisée
- **Affichage** : Montre le nom de la règle active
- **Clic sur le nom** : Ouvre un sélecteur pour changer de règle

### Moteur d'évaluation

```typescript
// src/app/ivy/caisse/lib/discountEngine.ts

interface CartItem {
  variantId: string;
  productType: string;
  price: number;
  quantity: number;
}

interface DiscountResult {
  itemDiscounts: Map<string, number>;  // variantId -> montant remise
  totalDiscount: number;
  appliedRules: string[];  // IDs des règles appliquées
}

function evaluateDiscounts(
  items: CartItem[], 
  rules: DiscountRule[]
): DiscountResult {
  // 1. Trier les règles par priorité
  // 2. Pour chaque règle active, parser et évaluer l'expression
  // 3. Appliquer les remises (combinables ou non)
  // 4. Retourner le résultat
}
```

### Parser de règles

Le parser transforme l'expression texte en AST évaluable :

```typescript
// Tokenizer : "items_count >= 2 -> discount("item[0]", 10)"
// -> tokens: [IDENT, GTE, NUMBER, ARROW, FUNC, LPAREN, STRING, COMMA, NUMBER, RPAREN]

// AST :
{
  type: "rule",
  condition: {
    type: "comparison",
    left: { type: "variable", name: "items_count" },
    operator: ">=",
    right: { type: "literal", value: 2 }
  },
  action: {
    type: "function_call",
    name: "discount",
    args: [
      { type: "literal", value: "item[0]" },
      { type: "literal", value: 10 }
    ]
  }
}
```

### Interface de configuration des règles

Page `/ivy/caisse/remises` ou modal dans les paramètres :

```
┌─────────────────────────────────────────────────────────────┐
│  Règles de remise                              [+ Nouvelle] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🏷️ Promo Stand 3+1                    [Actif] [✏️]  │   │
│  │ "3 articles achetés = -30% sur le moins cher"       │   │
│  │ Priorité: 1 | Combinable: Non                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🏷️ -10% dès 2 articles                [Actif] [✏️]  │   │
│  │ "10% de réduction sur le 2e article"                │   │
│  │ Priorité: 2 | Combinable: Oui                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Éditeur de règle

```
┌─────────────────────────────────────────────────────────────┐
│  Modifier la règle                                    [X]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Nom: [Promo Stand 3+1                              ]       │
│                                                             │
│  Description:                                               │
│  [3 articles achetés = -30% sur le moins cher       ]       │
│                                                             │
│  Expression:                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ items_count >= 3 -> discount("cheapest", 30)        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [?] Aide syntaxe                                           │
│                                                             │
│  Priorité: [1]     ☑️ Combinable avec d'autres règles       │
│                                                             │
│  [Tester]                              [Annuler] [Sauver]   │
└─────────────────────────────────────────────────────────────┘
```

### Fichiers additionnels

```
src/app/ivy/caisse/
├── ...
├── remises/
│   └── page.tsx              # Page de gestion des règles
├── components/
│   ├── ...
│   ├── DiscountToggle.tsx    # Toggle dans le panier
│   ├── DiscountRuleEditor.tsx # Éditeur de règle
│   └── DiscountRuleCard.tsx  # Carte d'affichage règle
└── lib/
    ├── discountEngine.ts     # Moteur d'évaluation
    ├── discountParser.ts     # Parser d'expressions
    └── discountFunctions.ts  # Fonctions disponibles

src/app/api/pos/
├── ...
└── discount-rules/
    └── route.ts              # CRUD règles de remise
```

### Phase additionnelle dans le TODO

### Phase 3.5 : Système de Remises
- [ ] Créer la table pos_discount_rules
- [ ] Implémenter le parser d'expressions
- [ ] Implémenter le moteur d'évaluation
- [ ] Créer DiscountToggle dans le panier
- [ ] Créer la page de gestion des règles
- [ ] API CRUD règles de remise
- [ ] Intégrer les remises dans le calcul du panier
- [ ] Sauvegarder la règle utilisée dans pos_sales

---

## 📊 Statistiques futures (hors scope initial)

- Ventes par vendeur (montant, nombre)
- Ventes par période (jour, semaine, mois)
- Produits les plus vendus
- Heures de pointe
- Taux de remboursement
