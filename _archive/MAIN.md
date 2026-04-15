# 📦 IVY - Documentation Complète

**Version:** 1.0.0 - Migration Supabase Multi-Tenant  
**Type:** Application SaaS de gestion de production et facturation

---

## 🎯 Vue d'ensemble

**IVY** est une application web SaaS de gestion de production. Elle synchronise les commandes depuis Shopify, gère le suivi de production avec un système de checkboxes, et automatise la facturation fournisseur.

### Objectifs principaux
1. **Multi-tenant** : Support de plusieurs boutiques par compte utilisateur
2. **Synchronisation Shopify** → Supabase en temps réel
3. **Suivi de production** avec système de checkboxes par article
4. **Facturation automatisée** basée sur des règles de prix configurables
5. **Gestion séparée** des commandes clients et des commandes stock (batch)

---

## 🏗️ Architecture Technique

### Stack Frontend
- **Framework:** Next.js 16.0.10 (App Router)
- **React:** 19.0.0
- **UI Library:** Mantine 7.15.1 (composants, modals, notifications)
- **State Management:** TanStack Query 5.62.7
- **Styling:** SASS + PostCSS + Mantine
- **Icons:** Tabler Icons 3.26.0
- **TypeScript:** 5.x

### Stack Backend
- **Base de données:** Supabase PostgreSQL
- **Authentification:** Supabase Auth
- **Realtime:** Supabase Realtime (remplace Firebase onSnapshot)
- **API:** Shopify Admin API (GraphQL) via `@shopify/admin-api-client`
- **Server Actions:** Next.js Server Actions

### Architecture Multi-Tenant

```
┌─────────────────────────────────────────────────────────────┐
│                        UTILISATEURS                         │
├─────────────────────────────────────────────────────────────┤
│  👤 Compte A → Boutique 1                                   │
│  👤 Compte B → Boutique 1, Boutique 2, Boutique 3           │
│  👤 Compte C → Boutique 2 (partagée avec B)                 │
└─────────────────────────────────────────────────────────────┘

Tables:
- shops: Boutiques Shopify (credentials stockés)
- user_shops: Liaison many-to-many (user_id, shop_id, role)
- Toutes les autres tables ont un shop_id pour l'isolation
```

### Row Level Security (RLS)
Chaque utilisateur ne voit que les données des boutiques auxquelles il appartient via la fonction `user_has_shop_access(shop_id)`.

### Tables Supabase

#### 1. `shops`
Boutiques Shopify connectées.

```sql
id UUID PRIMARY KEY
name TEXT NOT NULL
shopify_url TEXT NOT NULL
shopify_token TEXT NOT NULL
shopify_location_id TEXT
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

#### 2. `user_shops`
Liaison utilisateurs ↔ boutiques (many-to-many).

```sql
id UUID PRIMARY KEY
user_id UUID REFERENCES auth.users(id)
shop_id UUID REFERENCES shops(id)
role TEXT DEFAULT 'member'  -- 'owner', 'admin', 'member'
is_default BOOLEAN DEFAULT FALSE
created_at TIMESTAMPTZ
```

#### 3. `orders`
Commandes synchronisées depuis Shopify.

```sql
id UUID PRIMARY KEY
shop_id UUID REFERENCES shops(id)
shopify_id TEXT NOT NULL  -- gid://shopify/Order/XXX
name TEXT NOT NULL        -- #1234
  orderNumber: string,                 // Sans le # (1234)
  createdAt: string,                   // ISO date
  cancelledAt: string | null,
  displayFulfillmentStatus: string,    // UNFULFILLED, FULFILLED, etc.
  displayFinancialStatus: string,      // PAID, PENDING, REFUNDED, etc.
  totalPrice: string,
  totalPriceCurrency: string,
  note: string | null,
  tags: string[],                      // ["batch", "precommande", etc.]
  lineItems: [{
    id: string,
    title: string,
    quantity: number,
    refundableQuantity: number,
    price: string,
    sku: string,
    variantTitle: string,              // "Black / XL"
    vendor: string,
    productId: string,
    requiresShipping: boolean,
    taxable: boolean,
    image: { url: string, altText: string },
    unitCost: number,
    totalCost: number,
    isCancelled: boolean,
    variant: {
      id: string,
      title: string,
      selectedOptions: [{ name: string, value: string }],
      metafields: [{
        namespace: string,
        key: string,                   // fichier_d_impression, verso_impression, etc.
        value: string,
        type: string
      }]
    }
  }],
  synced_at: string                    // ISO date
}
```

**Filtrage:**
- Commandes clients: `tags` ne contient PAS "batch"
- Commandes stock: `tags` contient "batch"
- Exclues: `tags` contient "no-order-pro" ou "precommande"
- Commande #1465 toujours exclue

#### 2. `variants-ordered-v2`
Système de checkboxes pour le suivi de production textile.

**Structure:**
```typescript
{
  orderId: string,                     // ID encodé de la commande
  sku: string,                         // CREATOR 2.0, DRUMMER, etc.
  color: string,                       // Nom interne (Mocha, French Navy, etc.)
  size: string,                        // XS, S, M, L, XL, XXL, etc.
  productIndex: number,                // Index du produit dans lineItems
  quantityIndex: number,               // Index de la quantité (0, 1, 2...)
  checked: boolean,                    // État de la checkbox
  updatedAt: string                    // ISO date
}
```

**ID du document:** Format spécial pour unicité
```
orderId--sku--color--size--productIndex--quantityIndex
```

Exemple: `12345678--CREATOR 2.0--Mocha--XL--0--0`

#### 3. `textile-progress-v2`
Compteurs de progression pour chaque commande.

**Structure:**
```typescript
{
  totalCount: number,                  // Nombre total d'articles
  checkedCount: number,                // Nombre d'articles cochés
  updatedAt: string                    // ISO date
}
```

**ID du document:** `orderId` encodé

#### 4. `price-rules`
Règles de calcul de prix pour la facturation.

**Structure:**
```typescript
{
  searchString: string,                // Chaîne à rechercher (ex: "VR1", "CREATOR 2.0 BLACK")
  price: number,                       // Prix HT en euros
  createdAt: number                    // Timestamp
}
```

**Logique:** Le prix total d'un article = somme de tous les prix des règles dont la `searchString` est présente dans la description de l'article.

#### 5. `billing-notes`
Notes de facturation par commande.

**Structure:**
```typescript
{
  note: string,                        // Texte libre
  updatedAt: string                    // ISO date
}
```

**ID du document:** `orderId` encodé

#### 6. `monthly-balance`
Balance mensuelle pour ajustements de facturation.

**Structure:**
```typescript
{
  balance: number,                     // Montant HT en euros (peut être négatif)
  updatedAt: string                    // ISO date
}
```

**ID du document:** Format `YYYY-MM` (ex: "2025-01")

#### 7. `syncs`
Historique des synchronisations Shopify.

**Structure:**
```typescript
{
  startedAt: Timestamp,
  status: string,                      // "running", "completed", "failed"
  completedAt: Timestamp,
  ordersCount: number
}
```

---

## 🔄 Flux de données

### 1. Synchronisation Shopify → Firebase

**Endpoint:** `POST /api/sync`

**Processus:**
1. Création d'un document dans `syncs` (status: "running")
2. Appel à `fetchOrdersApiAction()` qui:
   - Se connecte à l'API Shopify GraphQL
   - Récupère toutes les commandes depuis le 1er octobre 2025
   - Pagine automatiquement (50 commandes par page)
   - Filtre les pourboires (tips)
   - Transforme les données au format interne
3. Sauvegarde dans `orders-v2` (écrase les données existantes)
4. Initialisation/mise à jour de `textile-progress-v2`
5. Mise à jour du document `syncs` (status: "completed")

**Fréquence:** Manuelle via le bouton "Synchroniser" dans l'interface

**Exclusions automatiques:**
- Commande #1465
- Tags: "no-order-pro", "precommande"
- Articles sans livraison et sans SKU (pourboires)

### 2. Système de checkboxes

**Fonctionnement:**
1. Chaque article d'une commande génère N checkboxes (N = quantité)
2. Chaque checkbox a un ID unique basé sur: `orderId--sku--color--size--productIndex--quantityIndex`
3. Cliquer sur une checkbox crée/met à jour un document dans `variants-ordered-v2`
4. Un listener Firestore met à jour `textile-progress-v2.checkedCount`
5. L'UI affiche la progression en temps réel (ex: "3/5")

**Transformation des couleurs:**
Les noms de couleurs Shopify (français) sont transformés en noms internes (anglais) pour cohérence:
- "Chocolat" → "Mocha"
- "Bleu Marine" → "French Navy"
- "Bordeaux" → "Burgundy"
- etc.

Voir `src/utils/color-transformer.ts` pour la liste complète.

### 3. Facturation

**Calcul du coût d'un article:**
1. Concaténation: `{quantity}x {sku} - {color} - {size} ({title})`
2. Recherche de toutes les règles dont `searchString` est présente
3. Somme des prix de toutes les règles trouvées
4. Ajout des frais de manutention (4.5€ HT par commande)
5. Ajout/soustraction de la balance mensuelle

**Exemple:**
- Article: "1x CREATOR 2.0 - Mocha - XL (T-shirt bio)"
- Règles trouvées:
  - "CREATOR 2.0" → 14€
  - "Mocha" → 2€
  - "XL" → 1€
- Total: 14 + 2 + 1 = 17€ HT

---

## 📱 Pages et Fonctionnalités

### Navigation

L'application est divisée en 2 sections principales:
- **ATELIER** (commandes clients)
- **IVY** (en développement)

### Section ATELIER

#### 1. `/detailed-orders` - Commandes détaillées (page d'accueil)

**Fonctionnalités:**
- Affichage en grille des commandes en cours (non expédiées)
- Tri par date (plus récentes/anciennes)
- Badges de statut:
  - Rouge: >14 jours
  - Jaune: 7-14 jours
  - Vert: <7 jours
- Pour chaque commande:
  - Numéro et statut financier
  - Jours écoulés depuis création
  - Progression textile (X/Y checkboxes)
  - Liste des articles avec images
  - Checkboxes individuelles par article
  - Métadonnées d'impression (fichier recto/verso)
  - Copie automatique du chemin NAS au clic
  - Bouton "Marquer comme expédié"
  - Note de commande si présente
- Rappels: étiquettes Stanley, mot de remerciement, sticker, flyer

**Données affichées:**
- Commandes avec `displayFulfillmentStatus != "FULFILLED"`
- ET `displayFinancialStatus != "REFUNDED"`
- ET `tags` ne contient PAS "batch"

#### 2. `/textile` - Textile à commander

**Fonctionnalités:**
- Regroupement des articles par SKU, couleur et taille
- Affichage du nombre total à commander
- Checkboxes pour marquer les articles commandés
- Actions groupées par SKU (tout cocher/décocher)
- Liste des numéros de commandes concernées (cliquables)
- Tri automatique par couleur puis taille

**Logique:**
- Récupère toutes les variantes non cochées depuis `variants-ordered-v2`
- Groupe par combinaison SKU + couleur + taille
- Affiche le total par groupe

#### 3. `/facturation-v2` - Facturation clients

**Fonctionnalités:**
- Sélection du mois à facturer
- Balance mensuelle ajustable
- Tableau par commande avec:
  - Date et numéro
  - Contenu détaillé (avec checkboxes de décompte)
  - Décompte des articles cochés
  - Coût détaillé par article
  - Frais de manutention (4.5€)
  - Balance mensuelle
  - Total HT
  - Bouton "Calculer le coût"
  - Checkbox "Facturé"
- Bouton "Facturer tout le mois" (génère un récapitulatif)
- Note de facturation éditable par mois
- Scroll horizontal avec drag

**Calcul:**
```
Total commande = Σ(coût articles) + frais manutention + balance mensuelle
```

#### 4. `/archived-orders` - Commandes archivées

Affiche les commandes expédiées (`displayFulfillmentStatus == "FULFILLED"`).

### Section Commandes Stock (Batch)

#### 5. `/batch` - Batch en cours

**Fonctionnalités:**
- Similaire à `/detailed-orders` mais pour les commandes avec tag "batch"
- Actions supplémentaires par commande:
  - Supprimer toutes les checkboxes
  - Cocher toutes les cases
  - Recalculer le comptage
- Note de facturation éditable
- Bouton de nettoyage des variantes invalides

**Données affichées:**
- Commandes avec `tags` contenant "batch"
- ET `displayFulfillmentStatus != "FULFILLED"`
- ET `displayFinancialStatus != "REFUNDED"`

#### 6. `/textile-batch` - Textile batch à commander

Même fonctionnement que `/textile` mais filtré sur les commandes batch.

#### 7. `/stock-invoices` - Facturation batch

Facturation des commandes stock avec regroupement par semaine.

#### 8. `/archived-batch` - Batchs archivés

Commandes batch expédiées.

### Section Réglages

#### 9. `/price-rules` - Règles de prix

**Fonctionnalités:**
- Liste de toutes les règles de prix
- Recherche par chaîne
- Tri alphabétique ou par date
- Ajout de nouvelles règles
- Édition/suppression de règles existantes

**Format:**
- Chaîne de recherche (ex: "VR1", "CREATOR 2.0 BLACK")
- Prix HT en euros

#### 10. `/color-mappings` - Règles de couleur

Gestion des mappings de couleurs (français → anglais).

### Section IVY

#### 11. `/ivy` - IVY (en développement)

Page placeholder pour la future section IVY.

### Autres

#### 12. `/login` - Connexion

Authentification Firebase avec email/mot de passe.

#### 13. `/orders` - Vue tableau (ancienne)

Vue tableau simplifiée des commandes (moins utilisée).

---

## 🔧 Composants Clés

### Composants de base

#### `VariantCheckbox`
Checkbox individuelle pour une variante textile.

**Props:**
- `orderId`: ID encodé de la commande
- `sku`: SKU du produit
- `color`: Couleur (nom interne)
- `size`: Taille
- `quantity`: Toujours 1 (une checkbox = un article)
- `productIndex`: Index dans lineItems
- `quantityIndex`: Index de quantité
- `variantId`: ID unique généré
- `disabled`: Désactiver la checkbox

**Comportement:**
- Lecture de l'état depuis `variants-ordered-v2/{variantId}`
- Mise à jour au clic
- Mise à jour du compteur dans `textile-progress-v2`

#### `VariantCheckboxGroup`
Groupe de checkboxes pour un article avec plusieurs quantités.

#### `OrderCheckboxSummary`
Affiche le décompte total des checkboxes cochées pour une commande (ex: "12/15").

#### `TextileProgress`
Badge de progression textile avec code couleur:
- Vert: 100% coché
- Jaune: 50-99% coché
- Rouge: 0-49% coché

#### `DaysElapsed`
Badge affichant le nombre de jours depuis la création avec code couleur:
- Vert: <7 jours
- Jaune: 7-14 jours
- Rouge: >14 jours

#### `FinancialStatus`
Badge du statut financier Shopify (PAID, PENDING, etc.).

#### `InvoiceCheckbox`
Checkbox "Facturé" pour marquer une commande comme facturée.

### Composants de facturation

#### `CalculateCostButton`
Bouton "Calculer le coût" qui:
1. Calcule le coût de chaque article selon les règles
2. Sauvegarde dans Firestore
3. Affiche une notification

#### `CostRow`
Affiche le détail du coût d'un article avec les règles appliquées.

#### `HandlingFeeCell`
Affiche et permet d'éditer les frais de manutention (défaut: 4.5€).

#### `OrderTotalCell`
Affiche le total HT d'une commande.

#### `OrderBalanceCell`
Affiche et permet d'éditer la balance d'une commande.

#### `MonthlyInvoiceButton`
Génère un récapitulatif de facturation pour tout un mois.

### Composants de navigation

#### `TopNavbar`
Barre de navigation supérieure avec:
- Logo Runes de Chêne
- Boutons ATELIER / IVY
- Version de l'application

#### `MainLayout`
Layout principal avec:
- Menu latéral gauche
- Compteurs de commandes en temps réel
- Bouton de synchronisation
- Bouton de déconnexion
- Zone de contenu

#### `SyncButton`
Bouton de synchronisation Shopify avec indicateur de chargement.

### Composants utilitaires

#### `OrderDrawer`
Drawer latéral affichant les détails complets d'une commande.

#### `CleanVariantsButton`
Nettoie les variantes invalides d'une commande (anciennes données corrompues).

---

## 🛠️ Utilitaires et Helpers

### `variant-helpers.ts`

#### `getSelectedOptions(item)`
Parse le `variantTitle` et retourne un tableau d'options.
Filtre automatiquement "Variante de motif" (utilisé pour l'impression, pas le textile).

#### `getColorFromVariant(item)`
Extrait la couleur d'un item et applique `transformColor()`.
Pour 3+ niveaux: avant-dernier élément = couleur.

#### `getSizeFromVariant(item)`
Extrait la taille d'un item.
Pour 3+ niveaux: dernier élément = taille.

#### `generateVariantId(...)`
Génère un ID unique pour une variante.
Format: `orderId--sku--color--size--productIndex--quantityIndex`

#### `getDefaultSku(title)`
Détermine un SKU par défaut basé sur le titre si le SKU est manquant.

### `color-transformer.ts`

#### `transformColor(color)`
Transforme un nom de couleur français en nom interne anglais.

**Exemples:**
- "Chocolat" → "Mocha"
- "Bleu Marine" → "French Navy"
- "Bordeaux" → "Burgundy"

#### `reverseTransformColor(englishColor)`
Transformation inverse (anglais → français).

### `firebase-helpers.ts`

#### `encodeFirestoreId(shopifyId)`
Encode un ID Shopify pour l'utiliser comme ID de document Firestore.
Extrait le numéro de `gid://shopify/Order/123456789` → `123456789`

### `size-helpers.ts`

#### `compareSizes(a, b)`
Compare deux tailles selon l'ordre: XS < S < M < L < XL < XXL < 2XL < 3XL < 4XL < 5XL

### `order-total.ts`

Fonctions de calcul des totaux de commandes avec application des règles de prix.

---

## 🔐 Authentification et Sécurité

### Firebase Auth
- Authentification par email/mot de passe
- Protection des routes via `AuthContext`
- Redirection automatique vers `/login` si non authentifié
- Bouton de déconnexion dans le menu

### Variables d'environnement

**Firebase:**
```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

**Shopify:**
```
SHOPIFY_URL
SHOPIFY_TOKEN
SHOPIFY_PROVIDER_LOCATION_ID
```

---

## 🐛 Problèmes Identifiés et Points d'Attention

### 1. ⚠️ Duplication de configuration Firebase

**Fichiers concernés:**
- `src/firebase/config.ts`
- `src/firebase/db.ts`

**Problème:** Les deux fichiers initialisent Firebase indépendamment, ce qui peut causer des conflits.

**Impact:** Faible (fonctionne actuellement grâce à `getApps()` check)

**Recommandation:** Fusionner en un seul fichier de configuration.

### 2. ⚠️ Incompatibilité version Node.js

**Problème:**
- `.nvmrc` spécifie Node.js v20
- Version actuelle: v22.12.0

**Impact:** Potentiels problèmes de compatibilité

**Recommandation:** Utiliser `nvm use 20` ou mettre à jour `.nvmrc` à 22

### 3. ⚠️ Requête Shopify hardcodée

**Fichier:** `src/graphql/queries.ts`

**Problème:** Date de début hardcodée: `created_at:>='2025-10-01'`

**Impact:** Ne récupère que les commandes depuis octobre 2025

**Recommandation:** Rendre la date configurable ou utiliser une date relative

### 4. ⚠️ Chemin NAS hardcodé (macOS)

**Fichiers:**
- `src/scenes/orders/DetailedOrdersPage.tsx` (lignes 270, 314)
- `src/scenes/batch/BatchPage.tsx` (lignes 272, 316)

**Problème:** Chemin macOS hardcodé: `/Utilisateurs/Mac/Desktop/NAS Runes de Chene/PRODUCTION/MOTIFS/`

**Impact:** Ne fonctionne pas sur Windows/Linux

**Recommandation:** Rendre le chemin configurable via variable d'environnement

### 5. ⚠️ Gestion des erreurs limitée

**Problème:** Peu de try/catch dans les composants, erreurs non loguées

**Impact:** Difficile de déboguer en production

**Recommandation:** Ajouter un système de logging centralisé (Sentry, LogRocket, etc.)

### 6. ⚠️ Pas de tests

**Problème:** Aucun test unitaire ou d'intégration

**Impact:** Risque de régression lors des modifications

**Recommandation:** Ajouter Jest + React Testing Library

### 7. ⚠️ Performance: Listeners Firestore multiples

**Problème:** Chaque checkbox crée un listener Firestore indépendant

**Impact:** Peut devenir lent avec beaucoup de commandes

**Recommandation:** Grouper les listeners ou utiliser des queries optimisées

### 8. ⚠️ Pas de pagination

**Problème:** Toutes les commandes sont chargées en mémoire

**Impact:** Ralentissement avec beaucoup de données

**Recommandation:** Implémenter la pagination Firestore

### 9. ⚠️ Section IVY non développée

**Fichier:** `src/app/ivy/page.tsx`

**Problème:** Page placeholder sans fonctionnalité

**Impact:** Bouton dans la navbar qui ne mène nulle part

**Recommandation:** Développer ou masquer temporairement

### 10. ⚠️ Logs de debug en production

**Fichiers:** Nombreux `console.log()` dans le code

**Impact:** Pollution de la console, potentielle fuite d'informations

**Recommandation:** Utiliser un système de logging avec niveaux (debug/info/error)

### 11. ⚠️ Calcul de coût manuel

**Problème:** L'utilisateur doit cliquer sur "Calculer le coût" pour chaque commande

**Impact:** Risque d'oubli, processus fastidieux

**Recommandation:** Calcul automatique lors de la synchronisation ou au changement de règles

### 12. ⚠️ Pas de validation des règles de prix

**Problème:** Possibilité de créer des règles en conflit ou redondantes

**Impact:** Calculs incorrects

**Recommandation:** Ajouter un système de validation et d'alerte

---

## 🚀 Améliorations Recommandées

### Priorité Haute

#### 1. Système de logging centralisé
- Intégrer Sentry ou LogRocket
- Remplacer les `console.log()` par un logger structuré
- Capturer les erreurs automatiquement

#### 2. Calcul automatique des coûts
- Calculer lors de la synchronisation Shopify
- Recalculer automatiquement si les règles changent
- Notification si des règles manquent

#### 3. Configuration externalisée
- Déplacer les constantes hardcodées vers `.env`
- Chemin NAS configurable
- Date de début des commandes configurable
- Frais de manutention configurables

#### 4. Optimisation des performances
- Pagination des commandes
- Lazy loading des images
- Virtualisation des listes longues
- Debounce sur les recherches

### Priorité Moyenne

#### 5. Tests automatisés
- Tests unitaires des helpers (variant-helpers, color-transformer)
- Tests d'intégration des services Firebase
- Tests E2E des flux critiques (synchronisation, facturation)

#### 6. Amélioration de l'UX
- Loading states plus clairs
- Messages d'erreur plus explicites
- Confirmations avant actions destructives
- Raccourcis clavier

#### 7. Gestion des règles de prix
- Interface de prévisualisation du calcul
- Détection des conflits
- Import/export des règles
- Historique des modifications

#### 8. Rapports et statistiques
- Dashboard avec KPIs
- Graphiques de production
- Export des facturations
- Historique des synchronisations

### Priorité Basse

#### 9. Mode hors ligne
- Service Worker pour cache
- Synchronisation différée
- Indicateur de statut réseau

#### 10. Notifications
- Notifications push pour nouvelles commandes
- Alertes pour commandes anciennes
- Rappels de facturation

#### 11. Multi-utilisateurs
- Rôles et permissions
- Historique des actions par utilisateur
- Collaboration temps réel

#### 12. Internationalisation
- Support multilingue (FR/EN)
- Formats de dates/nombres localisés
- Devises multiples

---

## 📊 Métriques et KPIs

### Métriques actuellement trackées
- Nombre de commandes en cours
- Nombre de commandes stock
- Progression textile par commande (X/Y)
- Jours écoulés depuis création
- Statut financier et d'expédition

### Métriques manquantes (à implémenter)
- Temps moyen de traitement d'une commande
- Taux de complétion par jour/semaine
- Coût moyen par commande
- Volume de production par SKU
- Taux d'erreur de synchronisation

---

## 🔄 Flux de travail typique

### 1. Réception de nouvelles commandes
1. Clic sur "Synchroniser" dans le menu
2. Attente de la synchronisation (quelques secondes)
3. Notification de succès avec nombre de commandes

### 2. Production textile
1. Aller sur `/detailed-orders`
2. Consulter les commandes par priorité (badges rouge/jaune/vert)
3. Pour chaque commande:
   - Cliquer sur les badges d'impression pour copier les chemins
   - Préparer les fichiers d'impression
   - Cocher les checkboxes au fur et à mesure de la production
4. Vérifier la progression (X/Y)

### 3. Commande de textile
1. Aller sur `/textile`
2. Consulter les articles à commander (regroupés par SKU/couleur/taille)
3. Passer commande au fournisseur
4. Cocher les articles commandés

### 4. Expédition
1. Retour sur `/detailed-orders`
2. Vérifier que tous les articles sont cochés (progression 100%)
3. Cliquer sur "Marquer comme expédié"
4. La commande disparaît de la liste

### 5. Facturation mensuelle
1. Aller sur `/facturation-v2`
2. Sélectionner le mois à facturer
3. Ajuster la balance mensuelle si nécessaire
4. Pour chaque commande:
   - Vérifier le décompte
   - Cliquer sur "Calculer le coût" si pas déjà fait
   - Vérifier le total
5. Cliquer sur "Facturer tout le mois"
6. Copier le récapitulatif généré
7. Cocher les commandes facturées

---

## 🎨 Design System

### Couleurs principales
- **Orange:** Couleur de marque (boutons, accents)
- **Vert:** Succès, statuts positifs
- **Jaune:** Avertissements, statuts moyens
- **Rouge:** Erreurs, urgences, statuts négatifs
- **Gris:** Texte secondaire, bordures

### Typographie
- **Titres:** Alegreya (Google Font)
- **Corps:** Inter (Google Font)

### Composants Mantine
- Utilisation extensive de la bibliothèque Mantine
- Thème personnalisé avec les couleurs de marque
- Composants: Paper, Badge, Button, Table, Modal, Drawer, etc.

---

## 📝 Conventions de code

### Nommage
- **Composants:** PascalCase (ex: `OrderDrawer.tsx`)
- **Hooks:** camelCase avec préfixe `use` (ex: `usePriceRules.ts`)
- **Utils:** camelCase (ex: `variant-helpers.ts`)
- **Types:** PascalCase (ex: `ShopifyOrder`)
- **Collections Firestore:** kebab-case avec version (ex: `orders-v2`)

### Structure des fichiers
```
src/
├── actions/          # Server Actions Next.js
├── app/              # Pages Next.js (App Router)
├── components/       # Composants réutilisables
├── config/           # Configuration (constantes)
├── context/          # React Contexts
├── firebase/         # Configuration et services Firebase
├── graphql/          # Requêtes GraphQL Shopify
├── hooks/            # Hooks personnalisés
├── layout/           # Layouts de page
├── scenes/           # Pages complexes (logique métier)
├── state/            # State management (TanStack Query)
├── style/            # Styles globaux
├── types/            # Types TypeScript
├── utils/            # Fonctions utilitaires
└── view-model/       # ViewModels (presenters)
```

### Imports
- Utilisation de l'alias `@/` pour les imports absolus
- Ordre: React → Next.js → Libraries → Components → Utils → Types

---

## 🔍 Points techniques avancés

### Système de variantes à N niveaux

**Problème résolu:** Support des produits avec 3+ niveaux de variantes (Couleur / Taille / Matière / etc.)

**Solution:**
- Parse du `variantTitle` pour extraire toutes les options
- Génération d'IDs uniques incluant toutes les options
- Rétrocompatibilité avec les variantes à 2 niveaux

**Documentation:** Voir `VARIANT_SYSTEM_UPDATE.md`

### Transformation des couleurs

**Problème:** Shopify utilise des noms français, le fournisseur des noms anglais

**Solution:**
- Mapping bidirectionnel français ↔ anglais
- Application de la transformation au plus tôt (lors de l'extraction)
- Cohérence garantie dans toute l'application

### Encodage des IDs Firestore

**Problème:** Les IDs Shopify (`gid://shopify/Order/123`) ne sont pas valides comme IDs de documents Firestore

**Solution:**
- Fonction `encodeFirestoreId()` qui extrait le numéro
- Utilisation systématique dans toute l'application
- Décodage automatique lors de la lecture

### Gestion des articles annulés

**Problème:** Shopify ne supprime pas les articles annulés, il met `refundableQuantity < quantity`

**Solution:**
- Calcul de `isCancelled = quantity > refundableQuantity`
- Exclusion des articles annulés des compteurs
- Affichage visuel différent (opacité réduite)

---

## 🎓 Glossaire

- **Batch:** Commande de stock (pour réapprovisionner l'inventaire)
- **Checkbox:** Case à cocher représentant un article textile à produire
- **Variante:** Combinaison de SKU + couleur + taille (+ autres options)
- **SKU:** Stock Keeping Unit, identifiant unique d'un produit (ex: CREATOR 2.0)
- **Line Item:** Article dans une commande Shopify
- **Metafield:** Champ personnalisé Shopify (ex: fichier d'impression)
- **Fulfilled:** Expédié (statut Shopify)
- **HT:** Hors Taxes
- **NAS:** Network Attached Storage (serveur de fichiers)
- **Sérigraphie:** Technique d'impression textile

---

## 📞 Support et Maintenance

### Logs importants à surveiller
- Erreurs de synchronisation Shopify
- Échecs de calcul de coût
- Conflits de checkboxes
- Erreurs Firebase

### Tâches de maintenance régulières
- Vérifier les synchronisations quotidiennes
- Nettoyer les anciennes commandes archivées (>6 mois)
- Sauvegarder les règles de prix
- Mettre à jour les mappings de couleurs si nouveaux produits

### Commandes utiles
```bash
# Développement local
pnpm dev

# Build de production
pnpm build

# Lancer en production
pnpm start

# Linter
pnpm lint
```

---

## 📚 Ressources et Documentation

### Documentation externe
- [Next.js 16 Docs](https://nextjs.org/docs)
- [Mantine UI](https://mantine.dev/)
- [Firebase Firestore](https://firebase.google.com/docs/firestore)
- [Shopify Admin API](https://shopify.dev/docs/api/admin-graphql)
- [TanStack Query](https://tanstack.com/query/latest)

### Documentation interne
- `VARIANT_SYSTEM_UPDATE.md` - Système de variantes à N niveaux
- `CLEAN_OLD_VARIANTS.md` - Nettoyage des anciennes données
- `DEBUG_SYNC.md` - Débogage de la synchronisation
- `TEST_VARIANTES_3_NIVEAUX.md` - Tests des variantes à 3 niveaux

---

**Dernière mise à jour:** 19 janvier 2026  
**Version de ce document:** 1.0
