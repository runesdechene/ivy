# Modèle douanier par emplacement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque emplacement porte un modèle douanier (caisses par type + matériel d'exposition) copié dans chaque nouveau passage, ajustable sur le passage, et imprimé à part sur la feuille de résumé.

**Architecture:** Une table `customs_location_templates` (une ligne par emplacement, listes en JSONB) et deux colonnes sur `customs_declarations` (`materiel`, `materiel_imprime`). Un module pur `src/lib/customs/materiel.ts` porte le type, la validation et les totaux. Il sert à l'API, aux deux écrans et au rendu imprimé. Un composant `MaterielEditor` sert à la fois dans Paramètres et sur le passage.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Mantine 7.17, Supabase (MCP `apply_migration`), pnpm.

**Spec:** `docs/superpowers/specs/2026-09-14-douane-modele-emplacement-design.md`

## Global Constraints

- pnpm uniquement ; TypeScript strict, pas de `any`.
- Pas de framework de tests : les fonctions pures se vérifient avec `node --experimental-strip-types` (Node 22.12) sur un script du scratchpad ; le reste sur le serveur de dev (`pnpm dev`, port 3000, base de PRODUCTION).
- Projet Supabase Ivy : `monessruufklcrrhzvub`. Après `apply_migration`, renommer la version en `060` dans `supabase_migrations.schema_migrations`.
- Tout query filtre par `shop_id`.
- `APP_VERSION` (`src/config/version.ts`) : patch +1 à chaque commit touchant `src/` (actuellement `0.5.147`).
- Identifiant d'emplacement = id Shopify en texte (`'80953442571'` pour le Boxer), comme `customs_declarations.location_id`.
- Saisies décimales : `allowedDecimalSeparators={['.', ',']}` et état `number | string` (sinon « 0, » efface le champ).
- Le matériel n'entre JAMAIS dans les totaux marchandise (pièces, valeur, TVA).
- Ne pas utiliser l'ancien module Conteneurs.
- Commits en français, sans accents dans le message, terminés par `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Migration 060

**Files:**
- Create: `supabase/migrations/060_customs_location_templates.sql`

**Interfaces:**
- Produces: table `customs_location_templates(shop_id, location_id TEXT, packaging_kg JSONB, materiel JSONB)`, colonnes `customs_declarations.materiel JSONB`, `customs_declarations.materiel_imprime BOOLEAN`.

- [ ] **Step 1: Écrire la migration**

```sql
-- Modele douanier par emplacement : le poids des caisses par type de produit et
-- le materiel d'exposition (tables, chaises, bannieres...) qui voyage avec le stand.
-- Un nouveau passage COPIE ce modele ; on l'ajuste ensuite pour le voyage.
CREATE TABLE IF NOT EXISTS customs_location_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,                        -- shopify_id, comme customs_declarations
  packaging_kg JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { "Le Confort": 18 }
  -- [{ "designation": "Table pliante", "quantite": 2, "poids_kg": 12, "valeur_eur": 60 }]
  -- poids et valeur UNITAIRES ; les totaux se calculent.
  materiel JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_id, location_id)
);

ALTER TABLE customs_location_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membres du shop : lecture des modeles douaniers" ON customs_location_templates
  FOR SELECT TO authenticated
  USING (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Membres du shop : ajout de modeles douaniers" ON customs_location_templates
  FOR INSERT TO authenticated
  WITH CHECK (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Membres du shop : modification des modeles douaniers" ON customs_location_templates
  FOR UPDATE TO authenticated
  USING (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Membres du shop : suppression des modeles douaniers" ON customs_location_templates
  FOR DELETE TO authenticated
  USING (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = (SELECT auth.uid())));

-- Le passage porte sa propre copie, modifiable pour le voyage.
ALTER TABLE customs_declarations
  ADD COLUMN IF NOT EXISTS materiel JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Faute d'avoir tout pese avant le depart, on peut retirer le materiel de la
  -- feuille imprimee sans vider la liste.
  ADD COLUMN IF NOT EXISTS materiel_imprime BOOLEAN NOT NULL DEFAULT TRUE;

-- Amorce : l'emplacement du passage d'aout recoit ses caisses, sans les cles mal encodees.
INSERT INTO customs_location_templates (shop_id, location_id, packaging_kg)
SELECT d.shop_id,
       d.location_id,
       COALESCE((SELECT jsonb_object_agg(k, v)
                 FROM jsonb_each(d.packaging_kg) AS e(k, v)
                 WHERE position(chr(65533) IN k) = 0), '{}'::jsonb)
FROM customs_declarations d
WHERE d.departed_on = '2026-08-23'
ON CONFLICT (shop_id, location_id) DO NOTHING;
```

- [ ] **Step 2: Appliquer** — MCP `apply_migration` (project `monessruufklcrrhzvub`, name `customs_location_templates`, query = le fichier).

- [ ] **Step 3: Renuméroter et vérifier** — MCP `execute_sql` :

```sql
update supabase_migrations.schema_migrations set version = '060' where name = 'customs_location_templates' and version <> '060';
select location_id, packaging_kg, materiel from customs_location_templates;
select column_name, data_type, column_default from information_schema.columns
where table_name = 'customs_declarations' and column_name in ('materiel', 'materiel_imprime');
```

Expected : une ligne `80953442571` avec `{"Le Confort": 18, "Le Moelleux": 12, "L'Ancestral": 1.5, "Le Zippé": 0, "Débardeur Femme": 0.8, "Débardeur Homme": 0.8}` et `[]` ; les deux colonnes présentes.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/060_customs_location_templates.sql
git commit -m "feat(douane): table des modeles par emplacement (migration 060)"
```

---

### Task 2: Module pur `materiel.ts`

**Files:**
- Create: `src/lib/customs/materiel.ts`
- Test: `<scratchpad>/check-materiel.mts` (hors repo)

**Interfaces:**
- Produces :
  - `interface ObjetMateriel { designation: string; quantite: number; poids_kg: number; valeur_eur: number }`
  - `interface LigneSaisie { designation: string; quantite: number | string; poids_kg: number | string; valeur_eur: number | string }`
  - `validerMateriel(raw: unknown): { materiel: ObjetMateriel[] } | { erreur: string }`
  - `depuisSaisie(lignes: LigneSaisie[]): { materiel: ObjetMateriel[] } | { erreur: string }`
  - `versSaisie(materiel: ObjetMateriel[]): LigneSaisie[]`
  - `totauxMateriel(materiel: ObjetMateriel[]): { objets: number; poidsKg: number; valeurEur: number }`
  - `validerCaisses(raw: unknown): Record<string, number> | null`

- [ ] **Step 1: Écrire le script de vérification**

`C:\Users\uriel\AppData\Local\Temp\claude\C--Users-uriel-Desktop-DEVS-ivy\544ee399-237b-4172-99c5-1dd64158b0b1\scratchpad\check-materiel.mts` :

```ts
import assert from 'node:assert/strict';
import {
  validerMateriel, depuisSaisie, versSaisie, totauxMateriel, validerCaisses,
} from 'file:///C:/Users/uriel/Desktop/DEVS/ivy/src/lib/customs/materiel.ts';

const table = { designation: 'Table pliante', quantite: 2, poids_kg: 12, valeur_eur: 60 };

assert.deepEqual(validerMateriel([table]), { materiel: [table] });
assert.deepEqual(validerMateriel([]), { materiel: [] });
assert.ok('erreur' in validerMateriel('pas une liste'));
assert.ok('erreur' in validerMateriel([{ ...table, designation: '  ' }]));
assert.ok('erreur' in validerMateriel([{ ...table, quantite: 0 }]));
assert.ok('erreur' in validerMateriel([{ ...table, quantite: 1.5 }]));
assert.ok('erreur' in validerMateriel([{ ...table, poids_kg: -1 }]));
assert.ok('erreur' in validerMateriel([{ ...table, valeur_eur: Number.NaN }]));
// La designation est nettoyee, jamais refusee pour des espaces autour.
assert.deepEqual(validerMateriel([{ ...table, designation: ' Table pliante ' }]), { materiel: [table] });
// Le message dit QUELLE ligne est fausse.
const e = validerMateriel([table, { ...table, quantite: 0 }]);
assert.ok('erreur' in e && e.erreur.includes('ligne 2'));

// Saisie : virgule decimale et texte en cours de frappe.
assert.deepEqual(
  depuisSaisie([{ designation: 'Banniere', quantite: '3', poids_kg: '1,5', valeur_eur: '25.5' }]),
  { materiel: [{ designation: 'Banniere', quantite: 3, poids_kg: 1.5, valeur_eur: 25.5 }] },
);
assert.ok('erreur' in depuisSaisie([{ designation: 'Banniere', quantite: '', poids_kg: 1, valeur_eur: 1 }]));
// Une ligne entierement vide est ignoree (bouton Ajouter clique pour rien).
assert.deepEqual(depuisSaisie([{ designation: '', quantite: '', poids_kg: '', valeur_eur: '' }]), { materiel: [] });
assert.deepEqual(versSaisie([table]), [table]);

assert.deepEqual(
  totauxMateriel([table, { designation: 'Chaise', quantite: 4, poids_kg: 3.5, valeur_eur: 15 }]),
  { objets: 6, poidsKg: 38, valeurEur: 180 },
);

assert.deepEqual(validerCaisses({ 'Le Confort': 18, 'Le Zippé': 0 }), { 'Le Confort': 18, 'Le Zippé': 0 });
assert.equal(validerCaisses({ 'Le Confort': -2 }), null);
assert.equal(validerCaisses(['x']), null);

console.log('materiel.ts : OK');
```

- [ ] **Step 2: Lancer, constater l'échec**

Run: `node --experimental-strip-types --no-warnings "<scratchpad>\check-materiel.mts"`
Expected: FAIL, `Cannot find module .../materiel.ts`.

- [ ] **Step 3: Écrire le module**

`src/lib/customs/materiel.ts` :

```ts
/**
 * Matériel d'exposition d'un stand : tables, chaises, bannières…
 *
 * Il passe la frontière avec la marchandise mais ne se vend pas : il revient
 * entier. Il n'entre donc JAMAIS dans les totaux de la marchandise (pièces,
 * valeur, TVA). Poids et valeur sont UNITAIRES ; la valeur est une estimation en
 * euros, une grande partie du matériel étant fabriquée par le déclarant.
 */

export interface ObjetMateriel {
  designation: string;
  quantite: number;
  /** Poids d'UN objet, en kg. */
  poids_kg: number;
  /** Valeur estimée d'UN objet, en euros. */
  valeur_eur: number;
}

/** Une ligne telle que tapée : Mantine renvoie « 1, » en texte pendant la frappe. */
export interface LigneSaisie {
  designation: string;
  quantite: number | string;
  poids_kg: number | string;
  valeur_eur: number | string;
}

type Resultat = { materiel: ObjetMateriel[] } | { erreur: string };

const positifOuNul = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** Contrôle une liste venue du réseau ou de la base. Une ligne fausse est refusée, jamais corrigée. */
export function validerMateriel(raw: unknown): Resultat {
  if (!Array.isArray(raw)) return { erreur: 'Le matériel doit être une liste' };
  const materiel: ObjetMateriel[] = [];
  for (const [i, item] of raw.entries()) {
    const ligne = `ligne ${i + 1}`;
    if (!item || typeof item !== 'object') return { erreur: `Matériel, ${ligne} : objet invalide` };
    const o = item as Record<string, unknown>;
    const designation = typeof o.designation === 'string' ? o.designation.trim() : '';
    if (!designation) return { erreur: `Matériel, ${ligne} : désignation manquante` };
    if (typeof o.quantite !== 'number' || !Number.isInteger(o.quantite) || o.quantite < 1) {
      return { erreur: `Matériel, ${ligne} : la quantité doit être un entier d'au moins 1` };
    }
    if (!positifOuNul(o.poids_kg)) return { erreur: `Matériel, ${ligne} : poids invalide` };
    if (!positifOuNul(o.valeur_eur)) return { erreur: `Matériel, ${ligne} : valeur invalide` };
    materiel.push({ designation, quantite: o.quantite, poids_kg: o.poids_kg, valeur_eur: o.valeur_eur });
  }
  return { materiel };
}

const nombre = (v: number | string): number =>
  typeof v === 'number' ? v : v.trim() === '' ? Number.NaN : Number(v.replace(',', '.'));

/** Convertit les lignes tapées, ignore les lignes entièrement vides, puis valide. */
export function depuisSaisie(lignes: LigneSaisie[]): Resultat {
  const remplies = lignes.filter(
    (l) => l.designation.trim() || String(l.quantite).trim() || String(l.poids_kg).trim() || String(l.valeur_eur).trim(),
  );
  return validerMateriel(remplies.map((l) => ({
    designation: l.designation,
    quantite: nombre(l.quantite),
    poids_kg: nombre(l.poids_kg),
    valeur_eur: nombre(l.valeur_eur),
  })));
}

export function versSaisie(materiel: ObjetMateriel[]): LigneSaisie[] {
  return materiel.map((o) => ({ ...o }));
}

export function totauxMateriel(materiel: ObjetMateriel[]): { objets: number; poidsKg: number; valeurEur: number } {
  return materiel.reduce(
    (t, o) => ({
      objets: t.objets + o.quantite,
      poidsKg: t.poidsKg + o.quantite * o.poids_kg,
      valeurEur: t.valeurEur + o.quantite * o.valeur_eur,
    }),
    { objets: 0, poidsKg: 0, valeurEur: 0 },
  );
}

/** Caisses par type : { type: kg ≥ 0 }. null si la forme est fausse. */
export function validerCaisses(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [type, kg] of Object.entries(raw as Record<string, unknown>)) {
    if (!positifOuNul(kg)) return null;
    out[type] = kg;
  }
  return out;
}
```

- [ ] **Step 4: Lancer, constater le succès**

Run: `node --experimental-strip-types --no-warnings "<scratchpad>\check-materiel.mts"`
Expected: `materiel.ts : OK`

- [ ] **Step 5: Commit**

```bash
git add src/lib/customs/materiel.ts src/config/version.ts   # APP_VERSION -> 0.5.148
git commit -m "feat(douane): module du materiel d'exposition (validation, totaux)"
```

---

### Task 3: API — modèle d'emplacement, création et modification du passage

**Files:**
- Create: `src/app/api/settings/customs-templates/route.ts`
- Modify: `src/app/api/customs/passages/route.ts` (POST : caisses et matériel depuis le modèle)
- Modify: `src/app/api/customs/passages/[id]/route.ts` (PATCH : `materiel`, `materielImprime`)
- Modify: `src/app/ivy/inventaire/douane/page.tsx` (avertissement sans modèle)

**Interfaces:**
- Consumes: `validerMateriel`, `validerCaisses` (Task 2).
- Produces :
  - `GET /api/settings/customs-templates?shopId&locationId` → `{ template: { packaging_kg: Record<string, number>; materiel: ObjetMateriel[] } | null }`
  - `PUT /api/settings/customs-templates` body `{ shopId, locationId, packagingKg, materiel }` → `{ template }` ou `400 { error }`
  - `PATCH /api/customs/passages/[id]` accepte `materiel: ObjetMateriel[]` et `materielImprime: boolean`.

- [ ] **Step 1: Route du modèle**

`src/app/api/settings/customs-templates/route.ts` :

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/supabase/client';
import { validerCaisses, validerMateriel } from '@/lib/customs/materiel';

/** GET ?shopId&locationId — le modèle douanier d'un emplacement, ou null s'il n'existe pas encore. */
export async function GET(request: NextRequest) {
  const shopId = request.nextUrl.searchParams.get('shopId');
  const locationId = request.nextUrl.searchParams.get('locationId');
  if (!shopId || !locationId) {
    return NextResponse.json({ error: 'shopId et locationId requis' }, { status: 400 });
  }
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('customs_location_templates')
    .select('packaging_kg, materiel, updated_at')
    .eq('shop_id', shopId)
    .eq('location_id', locationId)
    .maybeSingle();
  if (error) {
    console.error('GET /api/settings/customs-templates:', error);
    return NextResponse.json({ error: 'Lecture du modèle impossible' }, { status: 500 });
  }
  return NextResponse.json({ template: data });
}

/** PUT — enregistre le modèle entier. Une ligne fausse refuse tout l'envoi. */
export async function PUT(request: NextRequest) {
  const body = (await request.json()) as {
    shopId?: string; locationId?: string; packagingKg?: unknown; materiel?: unknown;
  };
  if (!body.shopId || !body.locationId) {
    return NextResponse.json({ error: 'shopId et locationId requis' }, { status: 400 });
  }
  const caisses = validerCaisses(body.packagingKg ?? {});
  if (!caisses) return NextResponse.json({ error: 'Poids de caisses invalide' }, { status: 400 });
  const materiel = validerMateriel(body.materiel ?? []);
  if ('erreur' in materiel) return NextResponse.json({ error: materiel.erreur }, { status: 400 });

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('customs_location_templates')
    .upsert(
      {
        shop_id: body.shopId,
        location_id: body.locationId,
        packaging_kg: caisses,
        materiel: materiel.materiel,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_id,location_id' },
    )
    .select('packaging_kg, materiel, updated_at')
    .single();
  if (error) {
    console.error('PUT /api/settings/customs-templates:', error);
    return NextResponse.json({ error: 'Enregistrement impossible' }, { status: 500 });
  }
  return NextResponse.json({ template: data });
}
```

- [ ] **Step 2: Création de passage** — dans `src/app/api/customs/passages/route.ts` :

1. Retirer `packaging_kg` du `select` de `previous` (il reste : `vat_pct, origin, origine_declaree, doc_sous_titre, raison_sociale, nom_prenom, adresse_siege, bureau_douane, regime_valeur, methode_repartition, designation_formulaire, tarif_formulaire`), et mettre à jour le commentaire au-dessus : les caisses viennent désormais du modèle de l'emplacement.
2. Supprimer la fonction `sansCorruption` (plus utilisée).
3. Juste après la requête `previous`, ajouter :

```ts
  // Caisses et materiel : copies du modele de CET emplacement (Parametres → Douane),
  // puis ajustables sur le passage. Sans modele, le passage part vide.
  const { data: modele } = await supabase
    .from('customs_location_templates')
    .select('packaging_kg, materiel')
    .eq('shop_id', shopId)
    .eq('location_id', locationId)
    .maybeSingle();
```

4. Dans l'`insert`, remplacer `packaging_kg: sansCorruption(...)` par :

```ts
      packaging_kg: modele?.packaging_kg ?? {},
      materiel: modele?.materiel ?? [],
```

5. Ajouter `sansModele: !modele` à l'objet JSON renvoyé en fin de POST.
6. Dans `src/app/ivy/inventaire/douane/page.tsx`, `handleCreate`, juste après la notification « Passage ouvert » :

```tsx
      if (data.sansModele) {
        notifications.show({
          title: "Pas de modèle pour cet emplacement",
          message: 'Caisses et matériel partent vides : renseigne-les sur le passage, ou crée le modèle dans Paramètres → Douane.',
          color: 'yellow',
          autoClose: false,
        });
      }
```

- [ ] **Step 3: PATCH du passage** — dans `src/app/api/customs/passages/[id]/route.ts`, ajouter l'import `import { validerMateriel } from '@/lib/customs/materiel';` et, juste avant le bloc `if (body.pricesChfTtc && ...)` :

```ts
  if (body.materiel !== undefined) {
    const materiel = validerMateriel(body.materiel);
    if ('erreur' in materiel) return NextResponse.json({ error: materiel.erreur }, { status: 400 });
    patch.materiel = materiel.materiel;
  }
  if (typeof body.materielImprime === 'boolean') patch.materiel_imprime = body.materielImprime;
```

- [ ] **Step 4: Vérifier sur le serveur de dev**

```powershell
$shop='99c08a32-ecf6-4d60-bbfd-1719dfcfce85'; $loc='80953442571'
Invoke-RestMethod "http://localhost:3000/api/settings/customs-templates?shopId=$shop&locationId=$loc" | ConvertTo-Json -Depth 5
try { Invoke-RestMethod http://localhost:3000/api/settings/customs-templates -Method Put -ContentType 'application/json' -Body (@{shopId=$shop;locationId=$loc;packagingKg=@{};materiel=@(@{designation='';quantite=1;poids_kg=1;valeur_eur=1})} | ConvertTo-Json -Depth 5) } catch { "HTTP $($_.Exception.Response.StatusCode.value__)" }
```

Expected : le modèle du Boxer avec ses caisses et `materiel: []` ; puis `HTTP 400` (désignation vide), sans écriture.

- [ ] **Step 5: `pnpm exec tsc --noEmit -p .`** — Expected : exit 0.

- [ ] **Step 6: Commit** (APP_VERSION → 0.5.149)

```bash
git add src/app/api/settings/customs-templates/route.ts src/app/api/customs/passages/route.ts "src/app/api/customs/passages/[id]/route.ts" src/app/ivy/inventaire/douane/page.tsx src/config/version.ts
git commit -m "feat(douane): API du modele d'emplacement, copie a la creation du passage"
```

---

### Task 4: Composant `MaterielEditor`

**Files:**
- Create: `src/components/customs/MaterielEditor.tsx`

**Interfaces:**
- Consumes: `LigneSaisie`, `depuisSaisie`, `totauxMateriel` (Task 2).
- Produces: `export function MaterielEditor(props: { lignes: LigneSaisie[]; onChange: (lignes: LigneSaisie[]) => void; tauxEurChf?: number; disabled?: boolean }): JSX.Element` et `export const LIGNE_VIDE: LigneSaisie`.

- [ ] **Step 1: Écrire le composant**

```tsx
'use client';

import { Table, TextInput, NumberInput, ActionIcon, Button, Text } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { depuisSaisie, totauxMateriel, type LigneSaisie } from '@/lib/customs/materiel';

export const LIGNE_VIDE: LigneSaisie = { designation: '', quantite: '', poids_kg: '', valeur_eur: '' };

const fmt = (n: number, d = 2) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Liste du matériel d'exposition, éditable ligne à ligne.
 *
 * Poids et valeur se saisissent pour UN objet ; le pied de tableau donne les
 * totaux. Les lignes en cours de frappe restent du texte : la conversion et la
 * validation se font à l'enregistrement, côté appelant, via `depuisSaisie`.
 */
export function MaterielEditor({ lignes, onChange, tauxEurChf, disabled }: {
  lignes: LigneSaisie[];
  onChange: (lignes: LigneSaisie[]) => void;
  tauxEurChf?: number;
  disabled?: boolean;
}) {
  const maj = (i: number, patch: Partial<LigneSaisie>) =>
    onChange(lignes.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  // Totaux sur les seules lignes valides : une ligne à moitié tapée ne fausse pas le pied.
  const valide = depuisSaisie(lignes);
  const totaux = 'materiel' in valide ? totauxMateriel(valide.materiel) : null;

  return (
    <>
      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Désignation</Table.Th>
            <Table.Th style={{ width: 110, textAlign: 'right' }}>Quantité</Table.Th>
            <Table.Th style={{ width: 140, textAlign: 'right' }}>Poids unitaire (kg)</Table.Th>
            <Table.Th style={{ width: 160, textAlign: 'right' }}>Valeur estimée unitaire (€)</Table.Th>
            <Table.Th style={{ width: 50 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {lignes.map((l, i) => (
            <Table.Tr key={i}>
              <Table.Td>
                <TextInput size="xs" value={l.designation} placeholder="ex. Table pliante" disabled={disabled}
                  onChange={(e) => maj(i, { designation: e.currentTarget.value })} />
              </Table.Td>
              <Table.Td>
                <NumberInput size="xs" value={l.quantite} min={1} allowDecimal={false} disabled={disabled}
                  onChange={(v) => maj(i, { quantite: v })} styles={{ input: { textAlign: 'right' } }} />
              </Table.Td>
              <Table.Td>
                <NumberInput size="xs" value={l.poids_kg} min={0} decimalScale={2} disabled={disabled}
                  allowedDecimalSeparators={['.', ',']}
                  onChange={(v) => maj(i, { poids_kg: v })} styles={{ input: { textAlign: 'right' } }} />
              </Table.Td>
              <Table.Td>
                <NumberInput size="xs" value={l.valeur_eur} min={0} decimalScale={2} disabled={disabled}
                  allowedDecimalSeparators={['.', ',']}
                  onChange={(v) => maj(i, { valeur_eur: v })} styles={{ input: { textAlign: 'right' } }} />
              </Table.Td>
              <Table.Td>
                <ActionIcon variant="subtle" color="rust" disabled={disabled}
                  onClick={() => onChange(lignes.filter((_, j) => j !== i))} aria-label="Retirer">
                  <IconTrash size={14} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
          {lignes.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={5}><Text size="sm" c="dimmed" ta="center">Aucun matériel.</Text></Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
        {totaux && totaux.objets > 0 && (
          <Table.Tfoot>
            <Table.Tr>
              <Table.Td><b>TOTAL</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{totaux.objets}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{fmt(totaux.poidsKg, 1)} kg</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                <b>{fmt(totaux.valeurEur)} €</b>
                {tauxEurChf ? <Text size="xs" c="dimmed">{fmt(totaux.valeurEur * tauxEurChf)} CHF</Text> : null}
              </Table.Td>
              <Table.Td />
            </Table.Tr>
          </Table.Tfoot>
        )}
      </Table>
      {'erreur' in valide && <Text size="xs" c="rust" mt={4}>{valide.erreur}</Text>}
      <Button variant="subtle" color="moss" size="xs" mt="xs" leftSection={<IconPlus size={14} />}
        disabled={disabled} onClick={() => onChange([...lignes, { ...LIGNE_VIDE }])}>
        Ajouter un objet
      </Button>
    </>
  );
}
```

- [ ] **Step 2: `pnpm exec tsc --noEmit -p .`** — Expected : exit 0.

- [ ] **Step 3: Commit** (APP_VERSION → 0.5.150)

```bash
git add src/components/customs/MaterielEditor.tsx src/config/version.ts
git commit -m "feat(douane): editeur de la liste du materiel d'exposition"
```

---

### Task 5: Paramètres → Douane, cadre « Modèle par emplacement »

**Files:**
- Modify: `src/app/parametres/douane/page.tsx`

**Interfaces:**
- Consumes: `GET/PUT /api/settings/customs-templates` (Task 3), `MaterielEditor`, `LIGNE_VIDE` (Task 4), `depuisSaisie`, `versSaisie`, `ObjetMateriel` (Task 2), `useLocation()` de `@/context/LocationContext` (`{ currentLocation, locations }`, `locations: { id: string; name: string }[]`).

- [ ] **Step 1: État et chargement** — ajouter aux imports : `Select`, `NumberInput` (Mantine), `useLocation`, `MaterielEditor`, `depuisSaisie`, `versSaisie`, `type LigneSaisie`, `type ObjetMateriel`. Dans le composant, après `const [rows, setRows] = …` :

```tsx
  const { currentLocation, locations } = useLocation();
  const [locationId, setLocationId] = useState<string | null>(null);
  const [caisses, setCaisses] = useState<Record<string, number | string>>({});
  const [materiel, setMateriel] = useState<LigneSaisie[]>([]);
  const [modeleCharge, setModeleCharge] = useState(false);
  const [modeleSaving, setModeleSaving] = useState(false);

  useEffect(() => {
    if (!locationId && currentLocation) setLocationId(String(currentLocation.id));
  }, [currentLocation, locationId]);

  useEffect(() => {
    if (!currentShop || !locationId) return;
    setModeleCharge(false);
    fetch(`/api/settings/customs-templates?shopId=${currentShop.id}&locationId=${locationId}`)
      .then((r) => r.json())
      .then((data: { template: { packaging_kg: Record<string, number>; materiel: ObjetMateriel[] } | null }) => {
        setCaisses(data.template?.packaging_kg ?? {});
        setMateriel(versSaisie(data.template?.materiel ?? []));
      })
      .catch(() => notifications.show({ title: 'Erreur', message: 'Modèle illisible', color: 'rust' }))
      .finally(() => setModeleCharge(true));
  }, [currentShop, locationId]);

  const saveModele = async () => {
    if (!currentShop || !locationId) return;
    const m = depuisSaisie(materiel);
    if ('erreur' in m) {
      notifications.show({ title: 'Matériel incomplet', message: m.erreur, color: 'rust' });
      return;
    }
    const packagingKg: Record<string, number> = {};
    for (const [type, v] of Object.entries(caisses)) {
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
      if (String(v).trim() !== '' && Number.isFinite(n) && n >= 0) packagingKg[type] = n;
    }
    setModeleSaving(true);
    try {
      const res = await fetch('/api/settings/customs-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: currentShop.id, locationId, packagingKg, materiel: m.materiel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Enregistrement impossible');
      setMateriel(versSaisie(data.template.materiel));
      notifications.show({ title: 'Modèle enregistré', message: 'Repris par les prochains passages de cet emplacement.', color: 'moss' });
    } catch (err) {
      notifications.show({ title: 'Erreur', message: err instanceof Error ? err.message : 'Enregistrement impossible', color: 'rust' });
    } finally {
      setModeleSaving(false);
    }
  };
```

- [ ] **Step 2: Le cadre** — après la fermeture du cadre des libellés (le `</div>` du premier `styles.card`), dans le `return` :

```tsx
      <div className={styles.card} style={{ marginTop: 28 }}>
        <div className={styles.cardHead}>
          <div>
            <h3 className={styles.cardHeadTitle}>Modèle par emplacement</h3>
            <p className={styles.cardHeadSub}>
              Copié dans chaque nouveau passage de cet emplacement, puis ajustable sur le passage.
              Poids et valeur du matériel s&apos;entendent pour UN objet ; la valeur est une estimation en euros.
            </p>
          </div>
          <Select
            data={locations.map((l) => ({ value: String(l.id), label: l.name }))}
            value={locationId}
            onChange={setLocationId}
            allowDeselect={false}
            w={240}
          />
        </div>
        <div className={styles.cardBody}>
          {!modeleCharge ? (
            <Loader size="sm" />
          ) : (
            <>
              <h4 className={styles.cardHeadTitle} style={{ fontSize: 14 }}>Caisses (kg) par type</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginBottom: 20 }}>
                {rows.map((r) => (
                  <NumberInput
                    key={r.productType}
                    label={r.productType}
                    size="xs"
                    value={caisses[r.productType] ?? ''}
                    onChange={(v) => setCaisses((prev) => ({ ...prev, [r.productType]: v }))}
                    min={0}
                    decimalScale={1}
                    allowedDecimalSeparators={['.', ',']}
                    suffix=" kg"
                  />
                ))}
              </div>
              <h4 className={styles.cardHeadTitle} style={{ fontSize: 14 }}>Matériel d&apos;exposition</h4>
              <MaterielEditor lignes={materiel} onChange={setMateriel} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button className={styles.primaryButton} onClick={saveModele} disabled={modeleSaving || !locationId}>
                  {modeleSaving ? 'Enregistrement…' : 'Enregistrer le modèle'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
```

- [ ] **Step 3: Vérifier** — `pnpm exec tsc --noEmit -p .` (exit 0), puis `http://localhost:3000/parametres/douane` : le Boxer affiche Le Confort 18, Le Moelleux 12… ; ajouter une ligne sans désignation → message rouge et enregistrement refusé ; lire le modèle via le GET de la Task 3, qui renvoie la liste enregistrée.

- [ ] **Step 4: Commit** (APP_VERSION → 0.5.151)

```bash
git add src/app/parametres/douane/page.tsx src/config/version.ts
git commit -m "feat(douane): modele par emplacement dans Parametres > Douane"
```

---

### Task 6: Feuille imprimée — tableau du matériel

**Files:**
- Modify: `src/lib/customs/render-passage.ts`
- Modify: `src/app/api/customs/passages/[id]/document/route.ts`
- Test: `<scratchpad>/check-rendu-materiel.mts` (hors repo)

**Interfaces:**
- Consumes: `ObjetMateriel`, `totauxMateriel` (Task 2).
- Produces: `PassageRow.materiel?: ObjetMateriel[]`, `PassageRow.materiel_imprime?: boolean`.

- [ ] **Step 1: Script de vérification**

```ts
import assert from 'node:assert/strict';
import { renderPassage } from 'file:///C:/Users/uriel/Desktop/DEVS/ivy/src/lib/customs/render-passage.ts';

const passage = {
  shop_id: 's', location_name: 'Boxer', status: 'open', reference: null, departed_on: '2026-09-16',
  returned_on: null, eur_to_chf: 0.94, vat_pct: 8.1, gross_weight_kg: null, origin: 'BD',
  prices_chf_ttc: {}, materiel_imprime: true,
  materiel: [{ designation: 'Table pliante', quantite: 2, poids_kg: 12, valeur_eur: 60 }],
};
const items = [{ product_title: 'T', product_type: 'Le Confort', image_url: null, size: 'M', color: 'Noir',
  qty_departed: 10, qty_returned: null, qty_sold_recorded: null, weight_grams: 200,
  unit_cost_textile: 5, unit_cost_print: 3, unit_price_eur: 30, incomplete: false }];

const avec = renderPassage(passage, items, { onlySummary: true });
assert.ok(avec.includes("Matériel d'exposition"));
assert.ok(avec.includes('Table pliante'));
assert.ok(avec.includes('24.0'));      // 2 x 12 kg
assert.ok(avec.includes('112.80'));    // 2 x 60 EUR x 0.94
// La marchandise ne bouge pas : 10 pieces, 80 EUR x 0.94 = 75.20 CHF.
assert.ok(avec.includes('Pièces déclarées</b> 10'));
assert.ok(avec.includes('75.20 CHF'));

const sans = renderPassage({ ...passage, materiel_imprime: false }, items, { onlySummary: true });
assert.ok(!sans.includes("Matériel d'exposition"));
assert.ok(!renderPassage({ ...passage, materiel: [] }, items, { onlySummary: true }).includes("Matériel d'exposition"));
assert.ok(renderPassage({ ...passage, status: 'closed' }, items, { onlySummary: true }).includes('en totalité'));
console.log('rendu materiel : OK');
```

- [ ] **Step 2: Lancer, constater l'échec** — Expected : assertion `Matériel d'exposition` en échec.

- [ ] **Step 3: Implémenter** — dans `render-passage.ts` :

1. Import : `import { totauxMateriel, type ObjetMateriel } from './materiel';`
2. Dans `PassageRow`, ajouter :

```ts
  /** Matériel d'exposition : hors marchandise, réexporté intégralement. */
  materiel?: ObjetMateriel[];
  /** Faux : le matériel reste enregistré mais ne s'imprime pas. */
  materiel_imprime?: boolean;
```

3. Juste avant `if (closed && ecartLignes.length > 0) {`, insérer :

```ts
  // ---------- Matériel d'exposition ----------
  // Tableau à part : il n'entre dans AUCUN total de la marchandise ci-dessus.
  const materiel = passage.materiel_imprime === false ? [] : (passage.materiel ?? []);
  if (materiel.length > 0) {
    const tm = totauxMateriel(materiel);
    html += `<h2>Matériel d'exposition — non destiné à la vente, réexporté intégralement</h2>
<table><thead><tr>
 <th class="l">Désignation</th><th>Quantité</th><th>Poids (kg)</th>
 <th>Valeur estimée (EUR)</th><th>Valeur estimée (CHF)</th>${closed ? '<th class="retour">Retour</th>' : ''}
</tr></thead><tbody>${materiel.map((o) => `<tr>
 <td class="l">${esc(o.designation)}</td><td>${o.quantite}</td><td>${kgv(o.quantite * o.poids_kg)}</td>
 <td>${num(o.quantite * o.valeur_eur)}</td><td>${num(o.quantite * o.valeur_eur * rate)}</td>
 ${closed ? '<td class="retour">en totalité</td>' : ''}
</tr>`).join('')}</tbody>
<tfoot><tr><td class="l">TOTAL</td><td>${tm.objets}</td><td>${kgv(tm.poidsKg)}</td>
 <td>${num(tm.valeurEur)}</td><td>${num(tm.valeurEur * rate)}</td>${closed ? '<td class="retour"></td>' : ''}</tr></tfoot></table>
<p style="font-size:7.5pt;color:#333;margin-top:2mm">Valeurs estimées par le déclarant. Ce matériel
 n'entre pas dans les totaux de la marchandise ci-dessus.</p>`;
  }
```

4. Dans `document/route.ts`, ajouter `materiel, materiel_imprime` au `select` de `customs_declarations`.

- [ ] **Step 4: Lancer, constater le succès** — Expected : `rendu materiel : OK`.

- [ ] **Step 5: Commit** (APP_VERSION → 0.5.152)

```bash
git add src/lib/customs/render-passage.ts "src/app/api/customs/passages/[id]/document/route.ts" src/config/version.ts
git commit -m "feat(douane): le materiel d'exposition s'imprime a part sur la feuille"
```

---

### Task 7: Page du passage — matériel, case d'impression, encadré vert

**Files:**
- Modify: `src/app/ivy/inventaire/douane/[id]/page.tsx`

**Interfaces:**
- Consumes: `PATCH` avec `materiel`, `materielImprime` (Task 3), `MaterielEditor` (Task 4), `depuisSaisie`, `versSaisie`, `totauxMateriel`, `ObjetMateriel`, `LigneSaisie` (Task 2).

- [ ] **Step 1: Types et état** — interface `Passage` : ajouter `materiel: ObjetMateriel[]; materiel_imprime: boolean;`. Imports : `Checkbox` (Mantine), `MaterielEditor`, `depuisSaisie`, `versSaisie`, `totauxMateriel`, `type ObjetMateriel`, `type LigneSaisie`. État :

```tsx
  const [materiel, setMateriel] = useState<LigneSaisie[]>([]);
  const [materielSaving, setMaterielSaving] = useState(false);
```

Dans `fetchPassage`, à l'intérieur du bloc `if (!hydratedRef.current)`, avant `hydratedRef.current = true;` :

```tsx
        setMateriel(versSaisie((data.passage?.materiel ?? []) as ObjetMateriel[]));
```

- [ ] **Step 2: Enregistrement** — après `commitPackaging` :

```tsx
  const patchPassage = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/customs/passages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Enregistrement impossible');
    setPassage(data.passage);
    return data.passage as Passage;
  }, [id]);

  const saveMateriel = useCallback(async () => {
    const m = depuisSaisie(materiel);
    if ('erreur' in m) {
      notifications.show({ title: 'Matériel incomplet', message: m.erreur, color: 'red' });
      return;
    }
    setMaterielSaving(true);
    try {
      const p = await patchPassage({ materiel: m.materiel });
      setMateriel(versSaisie(p.materiel));
      notifications.show({ title: 'Matériel enregistré', message: `${m.materiel.length} ligne(s)`, color: 'green' });
    } catch (err) {
      notifications.show({ title: 'Erreur', message: err instanceof Error ? err.message : 'Enregistrement impossible', color: 'red' });
    } finally {
      setMaterielSaving(false);
    }
  }, [materiel, patchPassage]);

  const materielEnregistre = passage?.materiel ?? [];
  const totauxMat = totauxMateriel(materielEnregistre);
```

(Les deux dernières lignes ne sont pas des hooks ; les placer après `saveMateriel`, avant les `return` anticipés.)

- [ ] **Step 3: Cadre « Matériel d'exposition »** — juste après la fermeture du `<Paper>` « Synthèse douanière » :

```tsx
      <Paper className={styles.panel} radius="md">
        <div className={styles.panelHead}>
          <h3 className={styles.panelTitle}>Matériel d&apos;exposition</h3>
          <Checkbox
            label="Imprimer le matériel sur la feuille de résumé"
            checked={passage.materiel_imprime}
            color="moss"
            onChange={(e) => {
              const v = e.currentTarget.checked;
              patchPassage({ materielImprime: v }).catch(() =>
                notifications.show({ title: 'Erreur', message: 'Enregistrement impossible', color: 'red' }));
            }}
          />
        </div>
        <Text size="xs" c="dimmed" mb="sm">
          Copié du modèle de l&apos;emplacement à la création du passage ; les changements ici ne valent que pour ce voyage.
          Hors marchandise : il n&apos;entre ni dans les pièces, ni dans la valeur, ni dans la TVA.
        </Text>
        <MaterielEditor lignes={materiel} onChange={setMateriel} tauxEurChf={computed.eurToChf} />
        <Group justify="flex-end" mt="sm">
          <Button color="moss" size="xs" onClick={saveMateriel} loading={materielSaving}>
            Enregistrer le matériel
          </Button>
        </Group>
      </Paper>
```

- [ ] **Step 4: Bloc « Matériel » de l'encadré vert** — dans le `<Paper>` « À recopier sur le 11.74 », juste avant le texte « Origine du textile… » :

```tsx
        {materielEnregistre.length > 0 && (
          <div style={{ marginTop: 16, opacity: passage.materiel_imprime ? 1 : 0.45 }}>
            <Text size="xs" fw={600} mb={4}>
              Matériel d&apos;exposition — séparé de la marchandise
              {!passage.materiel_imprime && ' (non imprimé sur la feuille)'}
            </Text>
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
              {([
                ['Objets', `${totauxMat.objets}`],
                ['Poids', `${totauxMat.poidsKg.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`],
                ['Valeur estimée', formatEur(totauxMat.valeurEur)],
                ['Valeur estimée', formatChf(totauxMat.valeurEur * computed.eurToChf)],
              ] as const).map(([label, value], i) => (
                <div key={i} className={styles.metricCard}>
                  <div className={styles.metricLabel}>{label}</div>
                  <div className={styles.metricValue}>{value}</div>
                </div>
              ))}
            </SimpleGrid>
          </div>
        )}
```

- [ ] **Step 5: Vérifier** — `pnpm exec tsc --noEmit -p .` (exit 0) ; sur le passage de test : ajouter deux objets, enregistrer, recharger (ils restent) ; décocher la case, puis ouvrir « Imprimer la feuille de résumé » : plus de tableau matériel, marchandise inchangée ; recocher : le tableau revient.

- [ ] **Step 6: Commit** (APP_VERSION → 0.5.153)

```bash
git add "src/app/ivy/inventaire/douane/[id]/page.tsx" src/config/version.ts
git commit -m "feat(douane): materiel d'exposition sur la page du passage"
```

---

### Task 8: Vérification de bout en bout

- [ ] **Step 1:** Dans Paramètres → Douane, saisir un objet de test dans le modèle du Boxer et enregistrer.
- [ ] **Step 2:** Via MCP `execute_sql`, vérifier `customs_location_templates.materiel` pour `80953442571`.
- [ ] **Step 3:** `pnpm build` : Expected `✓ Compiled successfully`.
- [ ] **Step 4:** Récapituler à Uriel : ce qui a été vérifié, ce qui reste à tester dans le navigateur (un nouveau passage de test qui reprend caisses et matériel), et les données de test à nettoyer (passage de test, objet de test du modèle).
