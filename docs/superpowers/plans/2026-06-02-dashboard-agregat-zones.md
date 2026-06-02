# Agrégat « Tous les festivals » sur le Tableau de bord — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter au tableau de bord du Stand un bloc agrégeant toutes les zones d'étude (compteurs + Top Fragments/Produits/Variantes), filtré par un multi-select d'emplacements à cases à cocher.

**Architecture:** Extraction de la logique d'agrégation (aujourd'hui inline dans `study-zones/stats/route.ts`) vers un helper pur partagé, consommé à la fois par la route par-zone existante et par un nouvel endpoint `aggregate-stats`. Le front (`stand/page.tsx`) gagne une section avec cases à cocher d'emplacements et tableaux de classement.

**Tech Stack:** Next.js 16 (App Router, route handlers), React 19, TypeScript strict, Mantine 7, Supabase (`@supabase/supabase-js`, service_role côté API).

**Conventions projet :** pnpm uniquement · pas de `any` · alias `@/*` → `./src/*` · multi-tenant : tout query DB filtre par `shop_id` · pas de framework de tests → vérif via `pnpm exec tsc --noEmit`, `pnpm lint`, dev server, comparaison SQL.

**Spec :** `docs/superpowers/specs/2026-06-02-dashboard-agregat-zones-design.md`

---

## File Structure

- **Create** `src/app/api/pos/study-zones/_lib/aggregate.ts` — fonction pure `aggregateMovements()` + types `MovementRow` / `AggregateResult`. Aucune I/O.
- **Modify** `src/app/api/pos/study-zones/stats/route.ts` — remplace les blocs totaux + topProducts + topVariants + topNames par un appel au helper. `topOptionsByCategory` et `movementsByDay` restent inline (spécifiques à la vue par-zone).
- **Create** `src/app/api/pos/study-zones/aggregate-stats/route.ts` — endpoint GET d'agrégat cross-zones, multi-emplacements.
- **Modify** `src/app/ivy/stand/page.tsx` — nouvelle section « Tous les festivals » (cases à cocher + compteurs + 3 tableaux).
- **Modify** `src/app/ivy/stand/stand-dashboard.module.scss` — ajout d'une classe `.aggSection`.
- **Modify** `src/config/version.ts` — bump patch.

---

## Task 1 : Helper d'agrégation partagé + refactor de la route par-zone

**Files:**
- Create: `src/app/api/pos/study-zones/_lib/aggregate.ts`
- Modify: `src/app/api/pos/study-zones/stats/route.ts` (lignes 64-95 et 154-170)

- [ ] **Step 1 : Créer le helper pur**

Create `src/app/api/pos/study-zones/_lib/aggregate.ts` :

```ts
export interface MovementRow {
  variant_id: string | null;
  product_title: string;
  variant_title: string | null;
  quantity: number;
  moved_on: string;
}

export interface AggregateResult {
  totalItemsOut: number;
  totalItemsReturn: number;
  topProducts: Array<{ name: string; quantity: number }>;
  topVariants: Array<{ name: string; quantity: number }>;
  topNames: Array<{ fullName: string; quantity: number }>;
}

/**
 * Agrège une liste de mouvements de stock (sorties = quantity < 0).
 * - topProducts : par product_title exact.
 * - topVariants : par "product_title — variant_title" (top 20).
 * - topNames (« Fragments ») : par NOM DE DESIGN = partie avant le séparateur
 *   "|" / "—". Surtout PAS de préfixe de longueur fixe (collisionne entre designs
 *   partageant un nom de collection, cf. fix du 2026-06-02 commit 826df29).
 */
export function aggregateMovements(movements: MovementRow[]): AggregateResult {
  const totalItemsOut = movements
    .filter(m => m.quantity < 0)
    .reduce((sum, m) => sum + Math.abs(m.quantity), 0);
  const totalItemsReturn = movements
    .filter(m => m.quantity > 0)
    .reduce((sum, m) => sum + m.quantity, 0);

  // Top products (par product_title exact)
  const productMap = new Map<string, number>();
  for (const m of movements) {
    if (m.quantity < 0) {
      productMap.set(m.product_title, (productMap.get(m.product_title) || 0) + Math.abs(m.quantity));
    }
  }
  const topProducts = Array.from(productMap.entries())
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity);

  // Top variants
  const variantMap = new Map<string, number>();
  for (const m of movements) {
    if (m.quantity < 0) {
      const key = `${m.product_title} — ${m.variant_title || 'Default'}`;
      variantMap.set(key, (variantMap.get(key) || 0) + Math.abs(m.quantity));
    }
  }
  const topVariants = Array.from(variantMap.entries())
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 20);

  // Top names (fragments) — regroupés par nom de design
  const nameMap = new Map<string, { fullName: string; quantity: number }>();
  for (const m of movements) {
    if (m.quantity < 0) {
      const displayName = m.product_title.split('|')[0].split('—')[0].trim();
      const key = displayName.toLowerCase();
      const existing = nameMap.get(key);
      if (existing) {
        existing.quantity += Math.abs(m.quantity);
      } else {
        nameMap.set(key, { fullName: displayName, quantity: Math.abs(m.quantity) });
      }
    }
  }
  const topNames = Array.from(nameMap.values())
    .sort((a, b) => b.quantity - a.quantity);

  return { totalItemsOut, totalItemsReturn, topProducts, topVariants, topNames };
}
```

- [ ] **Step 2 : Importer le helper dans la route par-zone**

In `src/app/api/pos/study-zones/stats/route.ts`, ajouter l'import sous les imports existants (ligne 2) :

```ts
import { aggregateMovements } from '../_lib/aggregate';
```

- [ ] **Step 3 : Remplacer les blocs totaux + top products/variants par l'appel helper**

Dans `stats/route.ts`, remplacer le bloc actuel (lignes 64-95, des commentaires « Total items out / return » jusqu'à la fin de `topVariants`) par :

```ts
  // Totals + top products / variants / names (logique partagée)
  const { totalItemsOut, totalItemsReturn, topProducts, topVariants, topNames } =
    aggregateMovements(allMovements as import('../_lib/aggregate').MovementRow[]);
```

> Note : `allMovements` reste défini juste au-dessus (ligne 62). `variantIds` (ligne 99) continue de dériver de `allMovements` — inchangé.

- [ ] **Step 4 : Supprimer le bloc topNames désormais dupliqué**

Dans `stats/route.ts`, supprimer entièrement le bloc « Top names » (anciennes lignes 154-170, du commentaire `// Top names (...)` jusqu'à `.sort((a, b) => b.quantity - a.quantity);` inclus). `topNames` est maintenant fourni par le helper (Step 3). **Conserver** `topOptionsByCategory` et `movementsByDay`. Le `return` final (qui référence `topProducts`, `topVariants`, `topNames`, etc.) reste inchangé.

- [ ] **Step 5 : Vérifier la compilation TypeScript**

Run: `pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6 : Vérifier la non-régression de la vue par-zone (dev server)**

Run: `pnpm dev`
Ouvrir `/ivy/stand/zones` → zone « Echo & Merveilles 2026 ». Vérifier que « Fragments les plus sortis » affiche bien `L'esprit de la loutre` (53), `L'esprit du Hibou` (33), `L'esprit du loup` (21) séparément (résultat identique à avant ce refactor).

- [ ] **Step 7 : Commit**

```bash
git add src/app/api/pos/study-zones/_lib/aggregate.ts src/app/api/pos/study-zones/stats/route.ts
git commit -F- <<'MSG'
refactor(study-zones): extrait aggregateMovements dans un helper partage

La logique totaux + top produits/variantes/fragments de stats/route.ts est
sortie dans _lib/aggregate.ts (fonction pure), pour etre reutilisee par le
futur endpoint d'agregat cross-zones. Comportement par-zone inchange.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 2 : Endpoint d'agrégat cross-zones

**Files:**
- Create: `src/app/api/pos/study-zones/aggregate-stats/route.ts`

- [ ] **Step 1 : Créer le route handler**

Create `src/app/api/pos/study-zones/aggregate-stats/route.ts` :

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { aggregateMovements, type MovementRow } from '../_lib/aggregate';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get('shopId');
  const locationIdsParam = searchParams.get('locationIds');

  if (!shopId) {
    return NextResponse.json({ error: 'Missing shopId' }, { status: 400 });
  }

  const emptyResult = {
    totalItemsOut: 0,
    totalItemsReturn: 0,
    topProducts: [],
    topVariants: [],
    topNames: [],
    zonesCount: 0,
    locationsCount: 0,
  };

  // 1. Toutes les zones du shop
  const { data: zones, error: zonesError } = await supabase
    .from('pos_study_zones')
    .select('date_from, date_to')
    .eq('shop_id', shopId);

  if (zonesError) {
    return NextResponse.json({ error: zonesError.message }, { status: 500 });
  }
  if (!zones || zones.length === 0) {
    return NextResponse.json(emptyResult);
  }

  // 2. Fenêtre globale
  const from = zones.reduce((min, z) => (z.date_from < min ? z.date_from : min), zones[0].date_from);
  const to = zones.reduce((max, z) => (z.date_to > max ? z.date_to : max), zones[0].date_to);

  // 3. Résolution des location IDs Shopify -> UUID
  const requestedIds = (locationIdsParam || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  let resolvedLocationIds: string[] = [];
  if (requestedIds.length > 0) {
    resolvedLocationIds = requestedIds.filter(id => UUID_RE.test(id));
    const toResolve = requestedIds.filter(id => !UUID_RE.test(id));
    if (toResolve.length > 0) {
      const { data: locs } = await supabase
        .from('locations')
        .select('id')
        .in('shopify_id', toResolve);
      if (locs) resolvedLocationIds.push(...locs.map(l => l.id));
    }
  }

  // 4. Une seule requête mouvements sur la fenêtre globale
  let query = supabase
    .from('stock_movements')
    .select('variant_id, product_title, variant_title, quantity, moved_on')
    .eq('shop_id', shopId)
    .gte('moved_on', from)
    .lte('moved_on', to);

  if (resolvedLocationIds.length > 0) {
    query = query.in('location_id', resolvedLocationIds);
  }

  const { data: movements, error: movementsError } = await query;
  if (movementsError) {
    return NextResponse.json({ error: movementsError.message }, { status: 500 });
  }

  // 5. Garder uniquement les mouvements dans au moins une plage de zone
  const ranges = zones.map(z => ({ from: z.date_from, to: z.date_to }));
  const filtered = ((movements as MovementRow[]) || []).filter(m =>
    ranges.some(r => m.moved_on >= r.from && m.moved_on <= r.to)
  );

  // 6. Agrégation
  const aggregate = aggregateMovements(filtered);

  return NextResponse.json({
    ...aggregate,
    zonesCount: zones.length,
    locationsCount: resolvedLocationIds.length,
  });
}
```

> Note : la résolution des emplacements suit le pattern existant de `stats/route.ts` (lookup `locations.shopify_id` sans filtre `shop_id`). `locationIds` vide ⇒ pas de filtre `location_id` ⇒ tous emplacements (utile pour appel direct API ; le front n'envoie jamais vide, cf. Task 3).

- [ ] **Step 2 : Vérifier la compilation TypeScript**

Run: `pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3 : Vérifier l'endpoint contre la BDD (dev server)**

Run: `pnpm dev` puis dans un navigateur/curl :
`/api/pos/study-zones/aggregate-stats?shopId=99c08a32-ecf6-4d60-bbfd-1719dfcfce85`
Expected (tous emplacements) : `topNames[0]` = `{ fullName: "L'esprit de la loutre", quantity: 53 }` et `zonesCount >= 1`. (Cohérent avec la seule zone existante « Echo & Merveilles 2026 ».)

- [ ] **Step 4 : Commit**

```bash
git add src/app/api/pos/study-zones/aggregate-stats/route.ts
git commit -F- <<'MSG'
feat(study-zones): endpoint aggregate-stats (cumul cross-zones multi-emplacements)

GET /api/pos/study-zones/aggregate-stats?shopId&locationIds : agrege tous les
mouvements tombant dans au moins une plage de zone d'etude du shop, filtres par
emplacements (resolus Shopify->UUID), via le helper aggregateMovements partage.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 3 : Section « Tous les festivals » sur le tableau de bord

**Files:**
- Modify: `src/app/ivy/stand/page.tsx`
- Modify: `src/app/ivy/stand/stand-dashboard.module.scss`
- Modify: `src/config/version.ts`

- [ ] **Step 1 : Étendre les imports Mantine dans `page.tsx`**

Dans `src/app/ivy/stand/page.tsx`, remplacer la ligne d'import Mantine (ligne 5) :

```ts
import { ActionIcon, Loader, SimpleGrid, Tooltip } from '@mantine/core';
```

par :

```ts
import { ActionIcon, Button, Checkbox, Group, Loader, Paper, SimpleGrid, Table, Text, Tooltip } from '@mantine/core';
```

- [ ] **Step 2 : Ajouter le type d'agrégat et consommer `locations` du contexte**

Dans `page.tsx`, sous l'interface `DashboardStats` (après ligne 29) ajouter :

```ts
interface AggregateStats {
  totalItemsOut: number;
  totalItemsReturn: number;
  topProducts: Array<{ name: string; quantity: number }>;
  topVariants: Array<{ name: string; quantity: number }>;
  topNames: Array<{ fullName: string; quantity: number }>;
  zonesCount: number;
  locationsCount: number;
}
```

Remplacer la ligne `const { currentLocation } = useLocation();` (ligne 33) par :

```ts
  const { currentLocation, locations } = useLocation();
```

- [ ] **Step 3 : Ajouter l'état et les effets de l'agrégat**

Dans `page.tsx`, sous les `useState` existants (après ligne 35, `const [loading, setLoading] = useState(true);`) ajouter :

```ts
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [aggStats, setAggStats] = useState<AggregateStats | null>(null);
  const [aggLoading, setAggLoading] = useState(false);
```

Puis, après le `useEffect` existant de chargement des stats (après sa fermeture ligne 92), ajouter deux effets :

```ts
  // Init : tous les emplacements cochés dès qu'ils sont chargés
  useEffect(() => {
    setSelectedLocationIds(locations.map(l => l.id));
  }, [locations]);

  // Charge l'agrégat cross-zones à chaque changement de sélection
  useEffect(() => {
    if (!currentShop?.id || locations.length === 0) return;
    if (selectedLocationIds.length === 0) { setAggStats(null); return; }

    const loadAgg = async () => {
      setAggLoading(true);
      try {
        const params = new URLSearchParams({
          shopId: currentShop.id,
          locationIds: selectedLocationIds.join(','),
        });
        const res = await fetch(`/api/pos/study-zones/aggregate-stats?${params}`);
        setAggStats(res.ok ? await res.json() : null);
      } catch {
        setAggStats(null);
      } finally {
        setAggLoading(false);
      }
    };
    loadAgg();
  }, [currentShop?.id, selectedLocationIds, locations.length]);
```

- [ ] **Step 4 : Insérer la section JSX**

Dans `page.tsx`, juste avant la fermeture `</div>` du `container` (avant la ligne `    </div>\n  );` finale du `return`, après le `</SimpleGrid>` des cartes temporelles), insérer :

```tsx
        <section className={styles.aggSection}>
          <div className={styles.pageHead}>
            <div className={styles.pageHeadLeft}>
              <h2 className={styles.title}>
                Tous les <em>festivals</em>
              </h2>
              <div className={styles.sub}>
                <span>Cumul de toutes les zones d&apos;étude</span>
              </div>
            </div>
          </div>

          <Paper withBorder p="md" radius="md" mb="md">
            <Group justify="space-between" mb="xs">
              <Text fw={600} size="sm">Emplacements</Text>
              <Group gap="xs">
                <Button size="xs" variant="subtle"
                  onClick={() => setSelectedLocationIds(locations.map(l => l.id))}>
                  Tout
                </Button>
                <Button size="xs" variant="subtle"
                  onClick={() => setSelectedLocationIds([])}>
                  Aucun
                </Button>
              </Group>
            </Group>
            <Checkbox.Group value={selectedLocationIds} onChange={setSelectedLocationIds}>
              <Group gap="md">
                {locations.map(loc => (
                  <Checkbox key={loc.id} value={loc.id} label={loc.name} />
                ))}
              </Group>
            </Checkbox.Group>
          </Paper>

          {selectedLocationIds.length === 0 ? (
            <div className={styles.errorWrap}>Sélectionnez au moins un emplacement.</div>
          ) : aggLoading ? (
            <div className={styles.loadingWrap}><Loader color="moss" /></div>
          ) : !aggStats || aggStats.zonesCount === 0 ? (
            <div className={styles.errorWrap}>Aucune zone d&apos;étude définie.</div>
          ) : (
            <>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" className={styles.metricsGrid}>
                <div className={styles.metricCard}>
                  <div className={styles.metricBody}>
                    <div className={styles.metricLabel}>Sorties (toutes zones)</div>
                    <div className={styles.metricValue}>
                      {aggStats.totalItemsOut.toLocaleString('fr-FR')}
                    </div>
                    <span className={styles.metricUnit}>
                      article{aggStats.totalItemsOut > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className={`${styles.metricIcon} ${styles.metricIcon_clay}`}>
                    <IconArrowDown size={20} />
                  </div>
                </div>
                <div className={styles.metricCard}>
                  <div className={styles.metricBody}>
                    <div className={styles.metricLabel}>Retours (toutes zones)</div>
                    <div className={`${styles.metricValue} ${styles.metricValueNeutral}`}>
                      {aggStats.totalItemsReturn.toLocaleString('fr-FR')}
                    </div>
                    <span className={styles.metricUnit}>
                      article{aggStats.totalItemsReturn > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className={`${styles.metricIcon} ${styles.metricIcon_slate}`}>
                    <IconArrowUp size={20} />
                  </div>
                </div>
              </SimpleGrid>

              <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md" mt="md">
                <Paper withBorder p="md" radius="md">
                  <Text fw={600} mb="sm">Fragments les plus sortis</Text>
                  <Table>
                    <Table.Thead>
                      <Table.Tr><Table.Th>Nom</Table.Th><Table.Th ta="right">Qté</Table.Th></Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {aggStats.topNames.slice(0, 15).map((n, i) => (
                        <Table.Tr key={i}>
                          <Table.Td>{n.fullName}</Table.Td>
                          <Table.Td ta="right">{n.quantity}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Paper>

                <Paper withBorder p="md" radius="md">
                  <Text fw={600} mb="sm">Produits les plus sortis</Text>
                  <Table>
                    <Table.Thead>
                      <Table.Tr><Table.Th>Produit</Table.Th><Table.Th ta="right">Qté</Table.Th></Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {aggStats.topProducts.slice(0, 15).map((p, i) => (
                        <Table.Tr key={i}>
                          <Table.Td>{p.name}</Table.Td>
                          <Table.Td ta="right">{p.quantity}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Paper>

                <Paper withBorder p="md" radius="md">
                  <Text fw={600} mb="sm">Variantes les plus sorties</Text>
                  <Table>
                    <Table.Thead>
                      <Table.Tr><Table.Th>Variante</Table.Th><Table.Th ta="right">Qté</Table.Th></Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {aggStats.topVariants.slice(0, 15).map((v, i) => (
                        <Table.Tr key={i}>
                          <Table.Td>{v.name}</Table.Td>
                          <Table.Td ta="right">{v.quantity}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Paper>
              </SimpleGrid>
            </>
          )}
        </section>
```

- [ ] **Step 5 : Ajouter la classe SCSS `.aggSection`**

Dans `src/app/ivy/stand/stand-dashboard.module.scss`, ajouter à la fin du fichier :

```scss
.aggSection {
  margin-top: 40px;
}
```

- [ ] **Step 6 : Bump version**

Dans `src/config/version.ts`, incrémenter le patch (ex. `0.5.72 - Ivy` → `0.5.73 - Ivy`) :

```ts
export const APP_VERSION = '0.5.73 - Ivy';
```

> Note : utiliser le numéro réel courant + 1 sur le patch au moment de l'exécution.

- [ ] **Step 7 : Vérifier compilation + lint**

Run: `pnpm exec tsc --noEmit`
Expected: aucune erreur.
Run: `pnpm lint`
Expected: aucune erreur sur les fichiers modifiés.

- [ ] **Step 8 : Vérifier le rendu (dev server)**

Run: `pnpm dev`
Ouvrir `/ivy/stand` :
- Le bloc « Tous les festivals » apparaît sous les cartes temporelles.
- Tous les emplacements sont cochés par défaut ; compteurs et 3 tableaux remplis (Top Fragments → `L'esprit de la loutre` en tête).
- Décocher un emplacement met à jour compteurs + tops ; « Aucun » ⇒ message « Sélectionnez au moins un emplacement » ; « Tout » recoche tout.

- [ ] **Step 9 : Commit + push**

```bash
git add src/app/ivy/stand/page.tsx src/app/ivy/stand/stand-dashboard.module.scss src/config/version.ts
git commit -F- <<'MSG'
feat(stand): bloc "Tous les festivals" sur le tableau de bord

Section agregeant toutes les zones d'etude : compteurs sorties/retours +
Top Fragments/Produits/Variantes, filtres par un multi-select d'emplacements
a cases a cocher (tous coches par defaut), via /api/pos/study-zones/aggregate-stats.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
git push origin main
```

> Push sur `main` ⇒ déploiement Netlify (prod). Confirmer avec l'utilisateur si besoin avant ce push.

---

## Self-Review

**Spec coverage :**
- Compteurs globaux ⇒ Task 1 (helper) + Task 3 Step 4 (cartes). ✓
- Top Fragments/Produits/Variantes ⇒ helper + Task 3 tableaux. ✓
- Multi-select cases à cocher, indépendant, tous cochés par défaut ⇒ Task 3 Steps 2-4. ✓
- Bloc sous les cartes temporelles, même page ⇒ Task 3 Step 4. ✓
- Endpoint dédié + helper partagé ⇒ Tasks 1 & 2. ✓
- Fenêtre globale + filtre « dans au moins une zone » (anti double-comptage) ⇒ Task 2 Steps. ✓
- Résolution Shopify→UUID ⇒ Task 2. ✓
- Cas limites (aucune zone / 0 emplacement / échec) ⇒ Task 2 (emptyResult) + Task 3 Step 4 (états vides/erreur). ✓
- Hors périmètre (pas d'options par catégorie, pas de temporel/export) ⇒ respecté. ✓

**Placeholder scan :** aucun TBD/TODO ; tout le code est fourni. ✓

**Type consistency :** `AggregateResult` (helper) ⊂ `AggregateStats` (front) + `zonesCount`/`locationsCount` ajoutés par l'endpoint ; `MovementRow` partagé entre helper, route par-zone et aggregate-stats ; `aggregateMovements` nommé identiquement partout. ✓
