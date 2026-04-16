# Ivy · Atelier boréal — Design Spec

**Date :** 2026-04-16
**Auteur :** Uriel + Claude (brainstorming session)
**Reference aesthetic :** [`/ATELIER_BOREAL.md`](../../../ATELIER_BOREAL.md) (design system prompt at repo root)
**Mockups :** `.superpowers/brainstorm/1559-1776327608/content/` (gitignored, reference only)

---

## 1 · Intent

Ivy a aujourd'hui un thème Mantine par défaut + fonts Inter/Alegreya + accents vert/orange standards. Aucune identité propre : l'app utilise le logo Runes de Chêne. Ce spec décrit l'implémentation de l'identité **Atelier boréal** (validée en brainstorm le 2026-04-16) sur toute l'app.

**Principe :** on restyle, on ne retire rien. Toute l'information actuellement visible dans Ivy reste visible. Les seules "optimisations" autorisées sont des regroupements (ex : 5 boutons d'action → 1 primary + ghost(s) + kebab) ou des remplacements sémantiques (ex : prix de vente → coût de production sur les vues atelier).

---

## 2 · Scope

### 2.1 — Dans le scope

#### Foundation
- **Fonts** : ajout de `Fraunces` (variable, display + italique) et `JetBrains Mono` (codes techniques) via `next/font/google`. `Inter` reste (body). `Alegreya` est retiré une fois la migration complète.
- **Tokens CSS** : ajout dans `src/app/globals.scss` des variables `--cream`, `--cream-soft`, `--cream-warm`, `--sand-soft`, `--ink`, `--slate`, `--slate-soft`, `--slate-muted`, `--divider`, `--divider-strong`, `--moss`, `--moss-soft`, `--moss-bg`, `--clay`, `--clay-bg`, `--rust`, `--plum`, `--plum-bg`, `--sand`.
- **Thème Mantine** : override dans `ClientLayout.tsx` avec `primaryColor: 'moss'`, custom colors (moss, clay, sand, plum, rust) en 10 shades chacune, `fontFamily: 'var(--font-inter)'`, `headings: { fontFamily: 'var(--font-fraunces)' }`, `defaultRadius: 'md'` (8px), radius scale alignée.

#### Mark & shell
- **Composant `<IvyMark />`** : wordmark Fraunces italic + point moss. Props : `size` (sm/md/lg/xl), `theme` (light/dark), `withParent` (affiche « par Runes de Chêne »).
- **TopNavbar refactor** : remplace le logo Runes de Chêne en image par `<IvyMark size="md" withParent />`. Boutons de nav passent au style Atelier boréal (actif = slate plein, inactif = ghost sur cream-warm hover). Shop selector en pill. Version en Fraunces italic.
- **Sidebar refactor** (`IvyLayout.tsx`) : fond `--cream-soft`, nav items actifs en `--moss-bg` + barre `--moss` 3px à gauche, bouton "Synchroniser" primaire en slate plein avec timestamp relatif.
- **Composant `<LastSyncTime />`** : hook `useLastSync(shopId)` qui requête la dernière entrée de `syncs` (ORDER BY completed_at DESC LIMIT 1) et la formate en relatif (« il y a 3min », « il y a 2h ») via `date-fns/formatDistanceToNow` avec locale `fr`. Intégré dans le bouton Synchroniser.

#### Composants partagés (nouveaux ou refactorés)
- `<IvyMark />` — wordmark réutilisable
- `<StatusBadge variant="moss|clay|sand|slate|plum">` — remplace les usages de `<Badge>` Mantine pour les statuts sémantiques (Payée, Urgent, À valider, Archivée, Imprimée)
- `<TagPill>` — pour tags Shopify (style pointillé, lowercase)
- `<MetaChip keyName value>` — pour métachamps (plum, clé Fraunces italic + valeur Inter)
- `<SkuChip>` — code SKU monospace discret
- `<FilterChip active count>` — chips de filtres (pill)
- `<ProductThumbnail variant image?>` — 48–54px, image Shopify si dispo, sinon gradient couleur variante + overlay texture
- `<CostDisplay qty unitCost>` — colonne coût (qty × unit + total + label "Coût")

#### Règles d'interaction (cartes de commandes)
- **La carte entière est cliquable** → navigue vers la page détail. Pas de bouton "Ouvrir" explicite sur les cartes list.
- **Bouton primaire "Feuillet"** → ouvre le feuillet d'impression (action rapide la plus fréquente). Unifié : feuillet de commande = feuillet d'impression = un seul flux.
- **Kebab `⋯`** → actions secondaires : Imprimer, Feuillet de production, Recalculer, Rafraîchir métachamps, Supprimer, et actions statut-dépendantes (Expédier, Archiver). Le kebab remplace toute rangée de 4+ boutons.
- **"Expédier"** n'apparaît pas sur la card list — action du détail uniquement.
- **Progress bar** dans le foot = % de variantes validées, toujours visible.

#### Pages à restyler (ordre d'importance)
1. **`/ivy/commandes/boutique`** (page iconique, grille 2 colonnes) — mockup v4 de référence
2. **`/ivy/commandes/stock/[orderId]`** (page détail batch, déjà complexe) — card head/body/foot + meta chips + cost column
3. **`/ivy/commandes/boutique/facturation`** — mêmes atomes, mais ici les **prix de vente restent** (c'est sa raison d'être)
4. **`/ivy/commandes/boutique/suivi`** — liste avec même esthétique
5. **`/ivy/inventaire/produits`** — product cards avec thumbnails
6. **`/ivy/inventaire`** (dashboard) — tokens appliqués, layout inchangé
7. **`/ivy/stand`** + `/ivy/stand/zones` — tokens appliqués
8. **`/ivy/hub`** (fullscreen, HUB de stand) — tokens + layout propre inchangé
9. **`/ivy/commandes/boutique/archives`**, `/ivy/inventaire/archives` — tokens appliqués
10. **`/parametres/*`** (descriptions, illustrations, prix, couleurs, metachamps) — refactor léger, atomes appliqués
11. **`/login`, `/signup`, `/onboarding`, `/ivy/profil`** — hero avec `<IvyMark size="xl" />`, fond cream

### 2.2 — Hors scope

- **Feuillets d'impression** (`/ivy/commandes/stock/[orderId]/feuillet`, `/impression`) — contexte d'impression papier, design propre à traiter plus tard en session dédiée
- **Dark mode** — pas demandé, Mantine color scheme reste en light
- **Responsive mobile** — on garde ce que Mantine donne par défaut, pas d'optimisation spécifique
- **Nouvelles features fonctionnelles** — sauf `<LastSyncTime />` qui est une petite feature portée par le design
- **Migration du logo Runes de Chêne** sur les documents imprimés (factures, feuillets) — reste dominant sur ces contextes, Ivy devient discret "via Ivy"

---

## 3 · Architecture technique

### 3.1 — Arbo des fichiers créés/modifiés

```
src/
├── app/
│   ├── layout.tsx                    (modif: fonts)
│   ├── globals.scss                  (modif: tokens CSS)
│   └── ...
├── components/
│   ├── ClientLayout.tsx              (modif: Mantine theme override)
│   ├── IvyMark/                      (nouveau)
│   │   ├── IvyMark.tsx
│   │   ├── IvyMark.module.scss
│   │   └── index.ts
│   ├── StatusBadge/                  (nouveau, remplace usages de Badge Mantine)
│   ├── TagPill/                      (nouveau)
│   ├── MetaChip/                     (nouveau)
│   ├── SkuChip/                      (nouveau)
│   ├── FilterChip/                   (nouveau)
│   ├── ProductThumbnail/             (nouveau, réutilise color-transformer)
│   ├── CostDisplay/                  (nouveau)
│   ├── LastSyncTime/                 (nouveau)
│   ├── TopNavbar/TopNavbar.tsx       (refactor)
│   └── ...
├── layout/
│   ├── IvyLayout.tsx                 (refactor sidebar)
│   └── IvyLayout.module.scss         (refactor)
├── hooks/
│   └── useLastSync.ts                (nouveau)
├── style/
│   ├── _tokens.scss                  (nouveau: export SCSS des CSS vars)
│   ├── _mantine.scss                 (existant, extensions mineures)
│   └── fonts.ts                      (modif: ajout fraunces + jetbrains mono)
└── ...
```

### 3.2 — Theme Mantine override

Dans `ClientLayout.tsx`, remplacer le `createTheme` minimal actuel par :

```ts
const theme = createTheme({
  primaryColor: 'moss',
  fontFamily: 'var(--font-inter)',
  fontFamilyMonospace: 'var(--font-jetbrains)',
  headings: { fontFamily: 'var(--font-fraunces)' },
  defaultRadius: 'md',
  radius: { xs: '4px', sm: '6px', md: '8px', lg: '10px', xl: '14px' },
  spacing: { xs: '4px', sm: '8px', md: '12px', lg: '20px', xl: '32px' },
  colors: {
    moss:  ['#f4f6ee', '#eaeee0', '#d8dfc3', '#c2cba3', '#a9b585', '#8a9a73', '#6b7a55', '#566344', '#424e33', '#2e3724'],
    clay:  ['#faf0e8', '#f2e1d3', '#e4c4a9', '#d4a887', '#c39070', '#b38566', '#9d6f54', '#855b45', '#6c4836', '#523628'],
    sand:  ['#faf4e7', '#f0e6cc', '#e6dcc7', '#d4c5a9', '#b8a885', '#998b67', '#7a6a45', '#625636', '#4a412a', '#332d1e'],
    plum:  ['#f8f2f5', '#ede2e9', '#dcc4d4', '#c5a8ba', '#ae8da2', '#94748a', '#7a5b72', '#63485c', '#4c3746', '#362630'],
    rust:  ['#fbefeb', '#f6dfd6', '#eebcaf', '#e39880', '#cf7862', '#b85f4b', '#a04b3d', '#843d31', '#683027', '#4d241d'],
    slate: ['#f2f3f5', '#e0e4e9', '#c6ccd4', '#a8b0bb', '#8b95a3', '#6e798a', '#556070', '#3d4654', '#2b3440', '#1a1f2a'],
    cream: ['#fdfcf9', '#faf7ef', '#f4f0e8', '#ede5d3', '#e0d5ba', '#c9ba97', '#ab9671', '#846f50', '#5c4d37', '#382f21'],
  },
});
```

**Les 10 shades** par color sont calculées pour que `colors.moss[6]` = `--moss` (#6b7a55) — convention Mantine où l'index 6 est la "primary value". On laisse Mantine dériver les hover/active states.

### 3.3 — Gestion des fonts

Dans `src/app/layout.tsx` :

```ts
import { Inter, Fraunces, JetBrains_Mono } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['opsz', 'SOFT', 'WONK'],
  style: ['normal', 'italic'],
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
  weight: ['400', '500'],
});
```

Alegreya est retiré **une fois toutes les pages migrées** (dernière phase). Avant ça, il reste importé pour ne pas casser les pages non encore migrées.

### 3.4 — Tokens SCSS

Créer `src/style/_tokens.scss` qui expose les CSS vars à SCSS via des variables natives :

```scss
$cream: var(--cream);
$slate: var(--slate);
$moss: var(--moss);
// ... etc
```

Les `module.scss` importent ce fichier : `@use '@/style/_tokens.scss' as *;`.

### 3.5 — Compat backward

- Les composants existants (`SyncButton`, `Badge`, `TextileProgress`, `VariantCheckbox`, etc.) sont **refactorés** plutôt que dupliqués. On évolue leurs styles internes pour matcher l'Atelier boréal.
- Les pages non encore migrées héritent quand même des tokens Mantine mis à jour (couleurs, typo) → elles auront déjà un look partiellement migré, pas de rupture visuelle brutale.

---

## 4 · Phases / séquencement

### Phase 1 — Foundation (~1-2h)
- Ajout fonts Fraunces + JetBrains Mono dans `layout.tsx`
- Création `src/app/globals.scss` tokens CSS
- Création `src/style/_tokens.scss`
- Mantine theme override dans `ClientLayout.tsx`
- Version bump : **0.4.0** (breaking visual change, même si aucune feature)

**Livrable :** aucun changement visible majeur sauf changements subtils de couleurs Mantine. Tokens disponibles pour la suite.

### Phase 2 — Mark & Shell (~2-3h)
- Composant `<IvyMark />`
- Hook `useLastSync`
- Composant `<LastSyncTime />`
- Refactor `TopNavbar.tsx`
- Refactor `IvyLayout.tsx` sidebar
- Bump : **0.4.1**

**Livrable :** l'app a son identité Ivy (mark + shell Atelier boréal). Toutes les pages s'affichent dans le nouveau shell.

### Phase 3 — Composants partagés (~2-3h)
- `<StatusBadge />`, `<TagPill />`, `<MetaChip />`, `<SkuChip />`, `<FilterChip />`, `<ProductThumbnail />`, `<CostDisplay />`
- Remplacer les usages existants de `Badge` Mantine par `StatusBadge` dans les composants concernés
- Bump : **0.4.2**

### Phase 4 — Pages principales (1-2h par page, ordre d'importance)
Chaque page fait l'objet d'**un commit séparé** avec bump patch (0.4.3, 0.4.4, ...).

1. `/ivy/commandes/boutique` (page iconique de référence)
2. `/ivy/commandes/stock/[orderId]`
3. `/ivy/commandes/boutique/facturation`
4. `/ivy/commandes/boutique/suivi`
5. `/ivy/inventaire/produits`
6. `/ivy/inventaire` (dashboard)
7. `/ivy/stand` + `/ivy/stand/zones`
8. `/ivy/hub`
9. Archives (boutique + inventaire)
10. `/parametres/*`
11. `/login`, `/signup`, `/onboarding`, `/ivy/profil`

### Phase 5 — Polish (~1h)
- Retrait Alegreya (fonts + imports)
- Audit hover/focus states
- Audit densité
- Audit contraste (WCAG AA minimum)
- Bump final : **0.5.0** (visual identity complete)

---

## 5 · Critères d'acceptation

- [ ] Toutes les pages rendent en palette Atelier boréal (aucun `#fff` brut ni `#000` brut dans l'output)
- [ ] Le theme override Mantine propage les couleurs custom à tous les composants Mantine
- [ ] Le mark Ivy apparaît en topnav + login + signup + onboarding
- [ ] Le bouton Synchroniser affiche « il y a Xmin » (ou « jamais » si aucune sync)
- [ ] Les métachamps apparaissent en chips plum partout où ils sont utilisés
- [ ] Les vues de production (`/ivy/commandes/boutique`, `/ivy/commandes/stock/[orderId]`) affichent le **coût** (pas le prix de vente). La page facturation conserve les prix de vente.
- [ ] Les actions secondaires des cartes de commandes sont regroupées dans un kebab menu (pas de rangée de 5+ boutons)
- [ ] `pnpm build` passe sans erreur TS
- [ ] Aucun warning console en dev sur les pages restylées
- [ ] Les pages non encore migrées ne sont pas cassées visuellement (dégradation gracieuse grâce au theme Mantine)

---

## 6 · Risques et mitigations

| Risque | Impact | Mitigation |
|---|---|---|
| Mantine v7 résiste à des overrides CSS custom | Moyen | Utiliser l'API theme au max (couleurs + radius + fontFamily) avant de tomber sur le CSS brut ; inspecter `data-mantine-color-scheme` selectors |
| Fraunces variable font alourdit le bundle | Faible | `display: 'swap'` + subset `latin` + ne charger que `opsz` variable (le reste en fallback statique) |
| Alegreya retiré trop tôt casse des pages | Moyen | Garder Alegreya chargé pendant phases 2–4, retrait uniquement en phase 5 |
| Les couleurs Mantine custom ont besoin de 10 shades | Faible | Générer via https://mantine.dev/colors-generator/ à partir du shade 6 cible |
| Hover states Mantine par défaut pas bons sur nos accents | Faible | Overrides locaux dans `ClientLayout.tsx` ou CSS global |
| Le cost n'est pas toujours calculé (price_rules pas appliquées à toutes les variantes) | Moyen | Fallback : afficher `—` au lieu de `0,00 €`. Bouton "Recalculer" accessible dans le kebab si besoin. |
| Les images produits Shopify ne sont pas toujours disponibles en thumbnail | Faible | Le composant `<ProductThumbnail />` utilise l'image si dispo, sinon gradient couleur variante (déjà mockupé) |

---

## 7 · Questions ouvertes (aucune bloquante)

- **Alegreya définitivement retiré ?** → Oui en phase 5, mais on peut garder une règle CSS fallback `font-family: Fraunces, Alegreya, serif` au cas où.
- **Le mark Ivy sur login/signup doit-il être centré hero ou en topnav discret ?** → Centré hero (xl size), c'est la première impression de l'identité.
- **Nom du wordmark sur factures PDF imprimées ?** → Runes de Chêne dominant, « via Ivy » en footer. Pas dans ce spec (hors scope impression).
- **Dark mode futur ?** → Prévoir les tokens en `[data-mantine-color-scheme='dark']` plus tard, pas maintenant. Les CSS vars actuelles sont toutes sous `:root` (light implicite).

---

## 8 · Références

- Design system prompt réutilisable : [`/ATELIER_BOREAL.md`](../../../ATELIER_BOREAL.md)
- Mockups validés (gitignorés, référence locale uniquement) :
  - `atelier-boreal-mockup-v4.html` — page Commandes boutique complète
  - `design-system.html` — référence composants + tokens
- Conversation d'origine : session brainstorm 2026-04-16
- Stack Ivy existante : voir `CLAUDE.md` à la racine
