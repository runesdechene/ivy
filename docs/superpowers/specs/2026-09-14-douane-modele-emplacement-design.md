# Modèle douanier par emplacement : caisses et matériel d'exposition — Design Spec

**Date :** 2026-09-14
**Statut :** approuvé (brainstorming validé avec Uriel)
**Branche :** `feat/douane-entree`
**Contrainte :** passage en douane le mercredi 2026-09-16

## Objectif

Chaque emplacement (le Boxer, par exemple) porte un **modèle douanier** : le poids des
caisses par type de produit, et la liste du **matériel d'exposition** qui voyage avec le
stand (tables, chaises, bannières…). Un nouveau passage copie ce modèle ; on l'ajuste
ensuite pour le voyage.

> **Révision du 2026-09-14 (après implémentation) : lecture en direct.** À la demande
> d'Uriel, caisses et matériel suivent la même règle que les libellés du référentiel :
> un passage **ouvert** les lit en direct dans le modèle de l'emplacement, et ils sont
> en **lecture seule** sur le passage. À la **clôture**, ils sont figés dans le passage.
> La copie faite à la création ne sert plus que de repli s'il n'existe pas de modèle.
> La case « Imprimer le matériel » reste propre au passage. Les sections ci-dessous qui
> parlent de caisses ou de matériel « modifiables sur le passage » sont remplacées
> par cette règle.

> **Révision 2 du 2026-09-14 : les caisses sont des fournitures.** Une caisse mélange
> les types : la grille « caisses par type » disparaît. Chaque fourniture porte une
> case `caisse` ; les caisses ne figurent pas dans le tableau du matériel
> d'exposition, et leur poids s'ajoute au **poids brut total** (case 24). **Aucune
> répartition par type** : sur la feuille, les colonnes Caisses et Poids brut par
> type restent vides, et une ligne indique « Tous les articles sont répartis dans
> X caisses ». La case « Imprimer le matériel » ne retire pas les caisses du brut.
> Les passages clôturés avant ce changement (août) gardent leurs caisses par type.
> Migration `061` : la grille du modèle du Boxer devient une ligne « Caisses (total
> repris d'août) », 1 × 33,1 kg.

## Contexte

- En août, le matériel du stand **n'a pas été déclaré**. Le 11.74 ne mentionne que les
  t-shirts et sweatshirts. Le déclarer désormais relève de la conformité.
- La forme attendue par la douane suisse est **inconnue** (2e ligne du 11.74, liste
  jointe, autre régime). Uriel la demandera au guichet le 16/09. Ivy prépare donc la
  liste sans présumer de la forme.
- Une grande partie du matériel est **fabriquée par Uriel** : la valeur est une
  **estimation en euros**, convertie au taux du passage.
- Aujourd'hui, les caisses se reprennent du **dernier passage créé**, quel que soit son
  emplacement.
- L'ancien module « Conteneurs » (`/parametres/conteneurs`) est abandonné et **n'est pas
  réutilisé**.

## Décisions

| Sujet | Décision |
|---|---|
| Stockage | Une ligne par emplacement, listes en JSONB (même style que `packaging_kg`) |
| Objet de matériel | désignation, quantité, poids unitaire (kg), valeur unitaire estimée (€) |
| Édition du modèle | Paramètres → Douane, sélecteur d'emplacement, bouton Enregistrer explicite |
| Création de passage | Caisses et matériel **copiés** du modèle de l'emplacement |
| Sur le passage | Caisses et matériel modifiables pour ce voyage |
| Totaux marchandise | Le matériel **n'y entre pas** (pièces, valeur, TVA inchangées) |
| TVA sur le matériel | Non calculée, faute de savoir si un dépôt est exigé |
| Retour | Matériel considéré comme intégralement revenu |

## Modèle de données — migration `060_customs_location_templates.sql`

```sql
CREATE TABLE customs_location_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,              -- shopify_id, comme customs_declarations
  packaging_kg JSONB NOT NULL DEFAULT '{}'::jsonb,
  materiel JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_id, location_id)
);

ALTER TABLE customs_declarations
  ADD COLUMN materiel JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN materiel_imprime BOOLEAN NOT NULL DEFAULT TRUE;
```

`materiel_imprime` : faute d'avoir pu tout peser ou remplir avant le départ, on peut
retirer le matériel de la feuille imprimée sans vider la liste.

RLS : membres du shop via `user_shops`, `TO authenticated`, `(SELECT auth.uid())`.

Amorce : le modèle de l'emplacement du passage d'août reçoit ses `packaging_kg`
(clés mal encodées écartées), matériel vide.

Forme d'un objet de matériel :

```json
{ "designation": "Table pliante", "quantite": 2, "poids_kg": 12, "valeur_eur": 60 }
```

`poids_kg` et `valeur_eur` sont **unitaires**. Les totaux se calculent, ils ne sont jamais stockés.

## Écrans

**Paramètres → Douane**, sous les libellés par type : cadre « Modèle par emplacement ».
- Sélecteur d'emplacement (liste de `/api/locations`).
- Caisses (kg) par type de produit de la boutique.
- Liste du matériel : ajouter et supprimer des lignes, totaux poids / valeur en pied.
- Bouton « Enregistrer le modèle ».

**Création de passage** (`POST /api/customs/passages`) : `packaging_kg` et `materiel`
viennent du modèle de l'emplacement. Sans modèle : vides.

**Page du passage** :
- Colonne Caisses de la synthèse inchangée (modifiable).
- Nouveau cadre « Matériel d'exposition », même éditeur, enregistré sur le passage
  (`PATCH`, champ `materiel`).
- Case à cocher « Imprimer le matériel sur la feuille de résumé », cochée par défaut
  (`materiel_imprime`). Décochée, le tableau matériel disparaît de la feuille et le bloc
  « Matériel » de l'encadré vert est grisé ; la liste reste enregistrée.
- Encadré vert « À recopier » : bloc « Matériel » séparé (objets, poids, valeur € / CHF).

## Feuille de résumé

Sous le tableau par type : tableau **« Matériel d'exposition — non destiné à la vente,
réexporté intégralement »**, avec les colonnes Désignation, Quantité, Poids (kg),
Valeur estimée (€), Valeur estimée (CHF), et une ligne TOTAL. Il est absent si la
liste est vide ou si `materiel_imprime` est faux. Passage clôturé : mention « revenu en totalité ».

## Validation

Côté serveur (modèle et passage) : désignation non vide, quantité entière ≥ 1, poids et
valeur ≥ 0. Une ligne invalide est refusée, jamais corrigée en silence.

## Hors périmètre

- La TVA ou le dépôt sur le matériel.
- Le rattachement du matériel à la 2e ligne du 11.74 (en attente de la réponse du douanier).
- Tout lien avec l'ancien module Conteneurs.
