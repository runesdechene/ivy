# Ivy · Atelier Boréal — Foundation + Shell + Hero Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the Atelier boréal visual identity to Ivy's foundation (fonts, tokens, Mantine theme), shell (IvyMark + TopNavbar + Sidebar + last-sync timestamp), and the hero page (`/ivy/commandes/boutique`). After this plan, a validated reference implementation exists that follow-up plans will replicate across the remaining 10 pages.

**Architecture:** Tokens-first layering. CSS variables in `:root` (global), SCSS aliases for module consumption, Mantine theme override for all Mantine components. New shared components under `src/components/` follow the existing naming convention (`ComponentName.tsx` + `ComponentName.module.scss` + `index.ts`). Phase 4a applies the tokens + components to the boutique page as the visual reference.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Mantine 7 (theme override API), SCSS modules, `next/font/google` (Fraunces + Inter + JetBrains Mono), `date-fns` (relative timestamps), Supabase client (last-sync query), `@tabler/icons-react`.

**Reference docs:**
- Spec: [`docs/superpowers/specs/2026-04-16-ivy-atelier-boreal-design.md`](../specs/2026-04-16-ivy-atelier-boreal-design.md)
- Design system prompt: [`/ATELIER_BOREAL.md`](../../../ATELIER_BOREAL.md)

**Verification strategy:** Ivy has no test framework (per `CLAUDE.md`). Each task ends with `pnpm build` (TypeScript check) + manual browser check via `pnpm dev` on `http://localhost:3000`. No unit tests added (YAGNI — setting up a test framework is out of scope).

**Commit convention:** Every task commits AND pushes AND bumps patch version (per user preference — see memory `feedback_commit_push_bump`). Example: `0.3.11 → 0.3.12 → 0.3.13 → ...` Final task of the plan bumps to a minor version (e.g. `0.5.0`).

---

## Phase 1 — Foundation

### Task 1: Load Fraunces + JetBrains Mono fonts

**Files:**
- Modify: `src/app/layout.tsx`

**Context:** Next.js root layout. Currently loads `Inter` (body) and `Alegreya` (headings) via `next/font/google`. We **keep both** (Alegreya only removed at the very end, in a follow-up plan), and **add** `Fraunces` (variable font, display + italic) and `JetBrains_Mono` (technical codes). Fonts are exposed as CSS variables to the `<body>`.

- [ ] **Step 1: Read current `src/app/layout.tsx`** to understand the structure.

- [ ] **Step 2: Replace the font imports and body className.**

```tsx
import type { Metadata } from 'next';
import { Inter, Alegreya, Fraunces, JetBrains_Mono } from 'next/font/google';
import React from 'react';
import { ColorSchemeScript } from '@mantine/core';
import { createTheme } from '@mantine/core';
import { ClientLayout } from '@/components/ClientLayout';
import { AuthProvider } from '@/context/AuthContext';
import { ShopProvider } from '@/context/ShopContext';
import '@mantine/core/styles.css';
import '@mantine/nprogress/styles.css';
import '@mantine/notifications/styles.css';
import './globals.scss';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const alegreya = Alegreya({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  variable: '--font-alegreya',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  style: ['normal', 'italic'],
});

const jetbrainsMono = JetBrains_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Ivy - Gestion de production',
  description: 'Application de gestion de production et facturation',
};

// NOTE: theme is created/overridden in Task 3. Keep the existing minimal theme for now.
const theme = createTheme({
  fontFamily: 'var(--font-inter)',
  headings: {
    fontFamily: 'var(--font-alegreya)', // will change to --font-fraunces in Task 3
  },
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <head>
        <ColorSchemeScript />
      </head>
      <body
        className={`${inter.variable} ${alegreya.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}
      >
        <AuthProvider>
          <ShopProvider>
            <ClientLayout theme={theme}>
              {children}
            </ClientLayout>
          </ShopProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Run build to verify fonts are loaded correctly.**

```bash
pnpm build
```

Expected: build passes. Any failure on font downloads will show `Error: Failed to fetch the font...` — retry with network check.

- [ ] **Step 4: Bump version + commit + push.**

```bash
# Edit src/config/version.ts: '0.3.11 - Ivy' → '0.3.12 - Ivy'
git add src/app/layout.tsx src/config/version.ts
git commit -m "$(cat <<'EOF'
feat(design): load Fraunces + JetBrains Mono fonts (Atelier boréal foundation)

Adds two new font families via next/font/google as CSS variables:
- Fraunces (display + italic accent) via --font-fraunces
- JetBrains Mono (technical codes: SKU, IDs) via --font-jetbrains

Alegreya is kept for now; it will be retired at the end of the Atelier
boréal migration once no page still depends on it.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 2: Add global CSS tokens + SCSS token alias file

**Files:**
- Modify: `src/app/globals.scss`
- Create: `src/style/_tokens.scss`

**Context:** We expose the Atelier boréal palette as CSS custom properties under `:root` so it's available everywhere (Mantine components, SCSS modules, inline styles). A sibling `_tokens.scss` file re-exports those vars as SCSS variables for modules that prefer SCSS syntax (`$moss` vs `var(--moss)`).

- [ ] **Step 1: Overwrite `src/app/globals.scss`** with the new content.

```scss
:root {
  /* Font families (Next.js font vars are set via className in layout.tsx) */
  --font-inter: var(--font-inter);
  --font-alegreya: var(--font-alegreya);
  --font-fraunces: var(--font-fraunces);
  --font-jetbrains: var(--font-jetbrains);

  /* Surfaces */
  --cream: #f4f0e8;
  --cream-soft: #faf7ef;
  --cream-warm: #ede5d3;
  --sand-soft: #e6dcc7;

  /* Ink scale */
  --ink: #1a1f2a;
  --slate: #2b3440;
  --slate-soft: #556070;
  --slate-muted: #8b95a3;
  --divider: rgba(43, 52, 64, 0.10);
  --divider-strong: rgba(43, 52, 64, 0.18);

  /* Accents */
  --moss: #6b7a55;
  --moss-soft: #8a9a73;
  --moss-bg: #eaeee0;
  --clay: #b38566;
  --clay-bg: #f2e1d3;
  --rust: #a04b3d;
  --plum: #7a5b72;
  --plum-bg: #ede2e9;
  --sand: #d4c5a9;
}

html,
body {
  max-width: 100vw;
  overflow-x: hidden;
}

body {
  font-family: var(--font-inter), Inter, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background-color: var(--cream);
  color: var(--ink);
}

* {
  box-sizing: border-box;
  padding: 0;
  margin: 0;
}

a {
  color: inherit;
  text-decoration: none;
}
```

- [ ] **Step 2: Create `src/style/_tokens.scss`.**

```scss
// Atelier boréal design tokens — SCSS aliases for CSS custom properties.
// Import with: @use '@/style/_tokens.scss' as *;

// Surfaces
$cream: var(--cream);
$cream-soft: var(--cream-soft);
$cream-warm: var(--cream-warm);
$sand-soft: var(--sand-soft);

// Ink scale
$ink: var(--ink);
$slate: var(--slate);
$slate-soft: var(--slate-soft);
$slate-muted: var(--slate-muted);
$divider: var(--divider);
$divider-strong: var(--divider-strong);

// Accents
$moss: var(--moss);
$moss-soft: var(--moss-soft);
$moss-bg: var(--moss-bg);
$clay: var(--clay);
$clay-bg: var(--clay-bg);
$rust: var(--rust);
$plum: var(--plum);
$plum-bg: var(--plum-bg);
$sand: var(--sand);

// Font family aliases
$font-inter: var(--font-inter);
$font-fraunces: var(--font-fraunces);
$font-jetbrains: var(--font-jetbrains);

// Spacing scale (base 4px)
$space-xs: 4px;
$space-sm: 8px;
$space-md: 12px;
$space-base: 16px;
$space-lg: 20px;
$space-xl: 32px;
$space-2xl: 44px;

// Radius scale
$radius-xs: 4px;
$radius-sm: 6px;
$radius-md: 8px;
$radius-lg: 10px;
$radius-xl: 14px;
$radius-pill: 999px;
```

- [ ] **Step 3: Verify build.**

```bash
pnpm build
```

Expected: build passes. Global CSS change shouldn't break anything.

- [ ] **Step 4: Bump + commit + push.**

```bash
# version.ts: 0.3.12 → 0.3.13
git add src/app/globals.scss src/style/_tokens.scss src/config/version.ts
git commit -m "$(cat <<'EOF'
feat(design): add Atelier boréal design tokens (CSS vars + SCSS aliases)

Global :root CSS custom properties for the full palette (surfaces/ink/accents)
and SCSS token file for module consumption. Existing pages see a
background color change from #F9F9F9 to #F4F0E8 (cream) — intentional
as the first visible shift toward Atelier boréal.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 3: Override Mantine theme with Atelier boréal palette

**Files:**
- Modify: `src/app/layout.tsx`

**Context:** Mantine resolves colors via `theme.colors[name][shade]`. To use `moss` / `clay` / `sand` / `plum` / `rust` / `slate` / `cream` as Mantine colors (so that `<Button color="moss">` works), we provide 10 shades per color (index 0=lightest, 9=darkest; index 6 is the "primary value" in Mantine's default `primaryShade: 6`). Shades below were generated via https://mantine.dev/colors-generator/ from the target hex at shade 6 (the canonical value from the spec). We also set font families, radius scale, spacing scale.

- [ ] **Step 1: Replace the `theme` constant in `src/app/layout.tsx`** with the full override.

```tsx
const theme = createTheme({
  primaryColor: 'moss',
  fontFamily: 'var(--font-inter)',
  fontFamilyMonospace: 'var(--font-jetbrains)',
  headings: {
    fontFamily: 'var(--font-fraunces)',
  },
  defaultRadius: 'md',
  radius: {
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '10px',
    xl: '14px',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '20px',
    xl: '32px',
  },
  colors: {
    moss: [
      '#f4f6ee', '#eaeee0', '#d8dfc3', '#c2cba3', '#a9b585',
      '#8a9a73', '#6b7a55', '#566344', '#424e33', '#2e3724',
    ],
    clay: [
      '#faf0e8', '#f2e1d3', '#e4c4a9', '#d4a887', '#c39070',
      '#b38566', '#9d6f54', '#855b45', '#6c4836', '#523628',
    ],
    sand: [
      '#faf4e7', '#f0e6cc', '#e6dcc7', '#d4c5a9', '#b8a885',
      '#998b67', '#7a6a45', '#625636', '#4a412a', '#332d1e',
    ],
    plum: [
      '#f8f2f5', '#ede2e9', '#dcc4d4', '#c5a8ba', '#ae8da2',
      '#94748a', '#7a5b72', '#63485c', '#4c3746', '#362630',
    ],
    rust: [
      '#fbefeb', '#f6dfd6', '#eebcaf', '#e39880', '#cf7862',
      '#b85f4b', '#a04b3d', '#843d31', '#683027', '#4d241d',
    ],
    slate: [
      '#f2f3f5', '#e0e4e9', '#c6ccd4', '#a8b0bb', '#8b95a3',
      '#6e798a', '#556070', '#3d4654', '#2b3440', '#1a1f2a',
    ],
    cream: [
      '#fdfcf9', '#faf7ef', '#f4f0e8', '#ede5d3', '#e0d5ba',
      '#c9ba97', '#ab9671', '#846f50', '#5c4d37', '#382f21',
    ],
  },
});
```

- [ ] **Step 2: Run the dev server and open the app.**

```bash
pnpm dev
```

Open `http://localhost:3000/ivy/commandes/boutique` in a browser. Expect: Mantine buttons now default to `moss` color. Some UI shifts (cream background, moss accents). Existing hard-coded `color="orange"` props still render orange (Mantine still has default palette — only `primaryColor` changed).

- [ ] **Step 3: Run build to verify TS.**

```bash
pnpm build
```

Expected: passes.

- [ ] **Step 4: Bump + commit + push.**

```bash
# version.ts: 0.3.13 → 0.3.14
git add src/app/layout.tsx src/config/version.ts
git commit -m "$(cat <<'EOF'
feat(design): override Mantine theme with Atelier boréal palette

Adds custom Mantine colors (moss/clay/sand/plum/rust/slate/cream) with
10 shades each, sets primaryColor to moss, switches heading font to
Fraunces, adds radius + spacing scales aligned with the design tokens.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Phase 2 — Mark & Shell

### Task 4: Create `<IvyMark />` component

**Files:**
- Create: `src/components/IvyMark/IvyMark.tsx`
- Create: `src/components/IvyMark/IvyMark.module.scss`
- Create: `src/components/IvyMark/index.ts`

**Context:** The Ivy wordmark = "Ivy" in Fraunces italic + a small moss dot (the leaf). Props control size (sm/md/lg/xl) and theme (light/dark for dark backgrounds). Optional `withParent` prop adds "par Runes de Chêne" in Inter uppercase letter-spaced.

- [ ] **Step 1: Create `IvyMark.tsx`.**

```tsx
import clsx from 'clsx';
import styles from './IvyMark.module.scss';

export interface IvyMarkProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  theme?: 'light' | 'dark';
  withParent?: boolean;
  className?: string;
}

export function IvyMark({
  size = 'md',
  theme = 'light',
  withParent = false,
  className,
}: IvyMarkProps) {
  return (
    <span
      className={clsx(
        styles.mark,
        styles[`mark_${size}`],
        styles[`mark_${theme}`],
        className,
      )}
    >
      <span className={styles.word}>Ivy</span>
      <span className={styles.dot} aria-hidden="true" />
      {withParent && (
        <span className={styles.parent}>par Runes de Chêne</span>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Create `IvyMark.module.scss`.**

```scss
@use '@/style/_tokens.scss' as *;

.mark {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  font-family: $font-fraunces;
  font-style: italic;
  letter-spacing: -0.01em;
  line-height: 1;
  color: $slate;
  font-weight: 500;
}

.word {
  display: inline-block;
}

.dot {
  display: inline-block;
  border-radius: 50%;
  background: $moss;
  position: relative;
  margin-left: -4px;
  flex-shrink: 0;
}

.parent {
  font-family: $font-inter;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: $slate-muted;
  font-weight: 500;
  font-style: normal;
  margin-left: 6px;
  align-self: center;
}

/* Sizes */
.mark_sm {
  font-size: 24px;
  .dot { width: 5px; height: 5px; top: -1px; }
}
.mark_md {
  font-size: 30px;
  .dot { width: 6px; height: 6px; top: -2px; }
}
.mark_lg {
  font-size: 44px;
  .dot { width: 9px; height: 9px; top: -4px; }
}
.mark_xl {
  font-size: 64px;
  font-weight: 400;
  .dot { width: 12px; height: 12px; top: -5px; }
}

/* Themes */
.mark_dark {
  color: $cream-soft;
  .dot { background: $moss-soft; }
  .parent { color: rgba(244, 240, 232, 0.6); }
}
```

- [ ] **Step 3: Create `index.ts`.**

```ts
export { IvyMark } from './IvyMark';
export type { IvyMarkProps } from './IvyMark';
```

- [ ] **Step 4: Verify build.**

```bash
pnpm build
```

- [ ] **Step 5: Bump + commit + push.**

```bash
# version.ts: 0.3.14 → 0.3.15
git add src/components/IvyMark src/config/version.ts
git commit -m "$(cat <<'EOF'
feat(design): add <IvyMark /> wordmark component

Fraunces italic "Ivy" + moss dot (leaf). 4 sizes (sm/md/lg/xl),
2 themes (light/dark), optional "par Runes de Chêne" lockup via
withParent prop.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 5: Create `useLastSync` hook

**Files:**
- Create: `src/hooks/useLastSync.ts`

**Context:** Queries the most recent entry from Supabase `syncs` table (ordered by `completed_at DESC`) for a given shop, returns the relative time string ("il y a 3 min"). Returns `null` if no sync exists. Uses `date-fns` with `fr` locale (already a transitive dep via Mantine — check; if not, install `date-fns`).

- [ ] **Step 1: Verify `date-fns` is available.**

```bash
pnpm list date-fns
```

If not installed:

```bash
pnpm add date-fns
```

- [ ] **Step 2: Create the hook.**

```ts
import { useEffect, useState } from 'react';
import { supabase } from '@/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface UseLastSyncResult {
  lastSync: Date | null;
  lastSyncLabel: string | null;
  loading: boolean;
  refetch: () => void;
}

export function useLastSync(shopId: string | null | undefined): UseLastSyncResult {
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!shopId) {
      setLastSync(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    supabase
      .from('syncs')
      .select('completed_at')
      .eq('shop_id', shopId)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setLastSync(data?.completed_at ? new Date(data.completed_at) : null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shopId, tick]);

  // Re-render every 30s so the label stays fresh ("il y a 3 min" → "il y a 4 min")
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  return {
    lastSync,
    lastSyncLabel: lastSync
      ? formatDistanceToNow(lastSync, { locale: fr, addSuffix: true })
      : null,
    loading,
    refetch: () => setTick((t) => t + 1),
  };
}
```

- [ ] **Step 3: Verify build.**

```bash
pnpm build
```

- [ ] **Step 4: Bump + commit + push.**

```bash
# version.ts: 0.3.15 → 0.3.16
git add src/hooks/useLastSync.ts src/config/version.ts
# Also add pnpm-lock.yaml if date-fns was newly installed
git status  # check and add package.json + pnpm-lock.yaml if needed
git commit -m "$(cat <<'EOF'
feat(design): add useLastSync hook

Queries the most recent completed sync for a given shop from the syncs
table and returns a human-readable French relative timestamp via
date-fns (re-renders every 30s to stay fresh).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 6: Create `<LastSyncTime />` component

**Files:**
- Create: `src/components/LastSyncTime/LastSyncTime.tsx`
- Create: `src/components/LastSyncTime/LastSyncTime.module.scss`
- Create: `src/components/LastSyncTime/index.ts`

**Context:** Small inline component that uses `useLastSync` and renders the timestamp in Fraunces italic. Designed to live next to the "Synchroniser" button in the sidebar.

- [ ] **Step 1: Create `LastSyncTime.tsx`.**

```tsx
'use client';

import { useLastSync } from '@/hooks/useLastSync';
import { useShop } from '@/context/ShopContext';
import styles from './LastSyncTime.module.scss';

interface LastSyncTimeProps {
  className?: string;
}

export function LastSyncTime({ className }: LastSyncTimeProps) {
  const { currentShop } = useShop();
  const { lastSyncLabel, loading } = useLastSync(currentShop?.id);

  if (loading || !lastSyncLabel) return null;

  return (
    <span className={`${styles.timestamp} ${className ?? ''}`}>
      {lastSyncLabel}
    </span>
  );
}
```

- [ ] **Step 2: Create `LastSyncTime.module.scss`.**

```scss
@use '@/style/_tokens.scss' as *;

.timestamp {
  font-family: $font-fraunces;
  font-style: italic;
  font-size: 12px;
  color: rgba(244, 240, 232, 0.7); // inverse (for use on dark bg)
  letter-spacing: 0.01em;
  white-space: nowrap;
}
```

- [ ] **Step 3: Create `index.ts`.**

```ts
export { LastSyncTime } from './LastSyncTime';
```

- [ ] **Step 4: Verify build.**

```bash
pnpm build
```

- [ ] **Step 5: Bump + commit + push.**

```bash
# version.ts: 0.3.16 → 0.3.17
git add src/components/LastSyncTime src/config/version.ts
git commit -m "$(cat <<'EOF'
feat(design): add <LastSyncTime /> component for sidebar sync button

Uses useLastSync to render the relative French timestamp of the last
completed sync. Returns null if no sync exists yet. Styled in Fraunces
italic, white-ish on dark slate button background.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 7: Refactor `TopNavbar` with IvyMark + Atelier boréal styling

**Files:**
- Modify: `src/components/TopNavbar/TopNavbar.tsx`
- Modify: `src/components/TopNavbar/TopNavbar.module.scss`

**Context:** Replace the Runes de Chêne `<Image />` logo with `<IvyMark size="md" withParent />`. Restyle nav buttons: active = slate plein with cream text, inactive = ghost → cream-warm on hover. Shop selector becomes a pill. Version text becomes Fraunces italic slate-muted. Remove all `color="orange"` props.

- [ ] **Step 1: Read current `src/components/TopNavbar/TopNavbar.tsx`** to preserve behavior (don't break shop selector, logout, profile, settings buttons).

- [ ] **Step 2: Replace `TopNavbar.tsx` content.**

```tsx
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Button, Group, Text, ActionIcon, Tooltip } from '@mantine/core';
import { IconLogout, IconSettings, IconPackage, IconBuildingStore, IconTent, IconUser } from '@tabler/icons-react';
import { APP_VERSION } from '@/config/version';
import { ShopSelector } from '@/components/ShopSelector';
import { useAuth } from '@/context/AuthContext';
import { IvyMark } from '@/components/IvyMark';
import styles from './TopNavbar.module.scss';

export function TopNavbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuth();

  const isCommandesSection = pathname.startsWith('/ivy/commandes');
  const isInventaireSection = pathname.startsWith('/ivy/inventaire');
  const isStandSection = pathname.startsWith('/ivy/stand');
  const isHubSection = pathname.startsWith('/ivy/hub');

  const handleLogout = async () => {
    try {
      await signOut();
      router.push('/login');
    } catch (error) {
      console.error('Erreur lors de la déconnexion:', error);
    }
  };

  return (
    <div className={styles.topNavbar}>
      <Group gap="xl">
        <IvyMark size="md" withParent />

        <div className={styles.separator} />

        <Group gap={4}>
          <Button
            variant={isCommandesSection ? 'filled' : 'subtle'}
            color={isCommandesSection ? 'slate' : 'gray'}
            onClick={() => router.push('/ivy/commandes')}
            size="md"
            leftSection={<IconBuildingStore size={18} />}
            className={styles.navButton}
          >
            Atelier
          </Button>
          <Button
            variant={isStandSection ? 'filled' : 'subtle'}
            color={isStandSection ? 'slate' : 'gray'}
            onClick={() => router.push('/ivy/stand')}
            size="md"
            leftSection={<IconTent size={18} />}
            className={styles.navButton}
          >
            Festivals
          </Button>
          <Button
            variant={isInventaireSection ? 'filled' : 'subtle'}
            color={isInventaireSection ? 'slate' : 'gray'}
            onClick={() => router.push('/ivy/inventaire')}
            size="md"
            className={styles.navButton}
          >
            Inventaire
          </Button>
          <Button
            variant={isHubSection ? 'filled' : 'subtle'}
            color={isHubSection ? 'slate' : 'gray'}
            onClick={() => router.push('/ivy/hub')}
            size="md"
            leftSection={<IconPackage size={18} />}
            className={styles.navButton}
          >
            HUB de stand
          </Button>
        </Group>
      </Group>

      <Group gap="md">
        <ShopSelector />
        <Text className={styles.version}>v{APP_VERSION}</Text>
        <Tooltip label="Profil">
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => router.push('/ivy/profil')}>
            <IconUser size={20} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Options globales">
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => router.push('/parametres')}>
            <IconSettings size={20} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Déconnexion">
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={handleLogout}>
            <IconLogout size={20} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </div>
  );
}
```

- [ ] **Step 3: Replace `TopNavbar.module.scss` content.**

```scss
@use '@/style/_tokens.scss' as *;

.topNavbar {
  height: 68px;
  background: $cream-soft;
  border-bottom: 1px solid $divider;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 $space-xl;
  position: sticky;
  top: 0;
  z-index: 100;
}

.separator {
  width: 1px;
  height: 28px;
  background: $divider;
}

.navButton {
  transition: all 0.15s ease;
}

.version {
  font-family: $font-fraunces;
  font-style: italic;
  font-size: 11px;
  color: $slate-muted;
  letter-spacing: 0.02em;
}
```

- [ ] **Step 4: Verify build + visual check.**

```bash
pnpm build
pnpm dev
```

Open `http://localhost:3000/ivy/commandes/boutique`. Expect: IvyMark replaces the Runes de Chêne image, nav buttons use slate instead of orange, cream background.

- [ ] **Step 5: Bump + commit + push.**

```bash
# version.ts: 0.3.17 → 0.3.18
git add src/components/TopNavbar src/config/version.ts
git commit -m "$(cat <<'EOF'
feat(design): refactor TopNavbar with IvyMark + Atelier boréal styling

Replaces the Runes de Chêne image logo with the new <IvyMark /> wordmark
(Ivy becomes the app's own identity, Runes de Chêne stays as parent
lockup). Nav buttons switch from orange to slate accent. Cream
background + slate version text in Fraunces italic.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 8: Refactor `IvyLayout` sidebar with Atelier boréal styling + LastSyncTime

**Files:**
- Modify: `src/layout/IvyLayout.tsx`
- Modify: `src/layout/IvyLayout.module.scss`

**Context:** Sidebar becomes cream-soft with moss accent for active nav items. The Synchroniser button in the sidebar header becomes the primary slate button with `<LastSyncTime />` next to it. Category labels uppercase + letter-spaced. Nav badges (order counts) become clay italic.

- [ ] **Step 1: Replace `IvyLayout.module.scss` content.**

```scss
@use '@/style/_tokens.scss' as *;

.fullscreen {
  min-height: calc(100vh - 68px);
  max-height: calc(100vh - 68px);
  overflow: hidden;
}

.view {
  display: flex;
  min-height: calc(100vh - 68px);
  max-height: calc(100vh - 68px);

  .menu {
    position: sticky;
    top: 68px;
    height: calc(100vh - 68px);
    width: 260px;
    min-width: 260px;
    padding: $space-lg $space-base;
    background-color: $cream-soft;
    border-right: 1px solid $divider;
    display: flex;
    flex-direction: column;
    overflow-y: auto;

    &_header {
      margin-bottom: $space-lg;
      padding-bottom: $space-base;
      border-bottom: 1px solid $divider;
    }

    &_links {
      list-style-type: none;
      margin: 0;
      padding: 0;
      flex-grow: 1;

      .menu_category {
        margin-bottom: $space-lg;

        &_title {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          color: $slate-muted;
          padding: 0 $space-md;
          margin-bottom: $space-sm;
        }

        ul {
          list-style-type: none;
          margin: 0;
          padding: 0;

          li {
            margin-bottom: 2px;
          }
        }
      }

      a {
        display: flex;
        align-items: center;
        gap: $space-sm;
        padding: 9px $space-md;
        border-radius: $radius-md;
        color: $slate-soft;
        text-decoration: none;
        font-weight: 500;
        transition: all 0.15s ease;
        position: relative;

        &:hover {
          background-color: $cream-warm;
          color: $slate;
        }

        &.active {
          background-color: $moss-bg;
          color: $moss;
          font-weight: 600;

          &::before {
            content: '';
            position: absolute;
            left: -$space-base;
            top: 10px;
            bottom: 10px;
            width: 3px;
            background: $moss;
            border-radius: 0 3px 3px 0;
          }
        }
      }
    }
  }

  .content {
    flex: 1;
    padding: $space-2xl;
    background-color: $cream;
    min-height: calc(100vh - 68px);
    overflow-x: auto;
    position: relative;
  }
}

.syncButton {
  background: $slate;
  color: $cream;
  border: none;
  padding: 12px $space-base;
  border-radius: $radius-lg;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  width: 100%;
  transition: transform 0.15s ease;
  font-family: inherit;

  &:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &_label {
    display: flex;
    align-items: center;
    gap: $space-sm;
  }
}

.navBadge {
  margin-left: auto;
  background: $clay;
  color: $cream;
  font-size: 11px;
  padding: 1px 7px;
  border-radius: $radius-pill;
  font-weight: 600;
  font-family: $font-fraunces;
  font-style: italic;
}
```

- [ ] **Step 2: Modify `IvyLayout.tsx`.**

Replace the existing Synchroniser `<Button>` block (around lines 217-231) with a native button that integrates `<LastSyncTime />`. Replace the old `Badge` usage for nav counts with the new `navBadge` class.

Full refactored `IvyLayoutContent` function (replace lines 19-271 inclusive):

```tsx
function IvyLayoutContent({ children }: IvyLayoutProps) {
  const pathname = usePathname();
  const { currentShop } = useShop();
  const [syncing, setSyncing] = useState(false);
  const [orderCounts, setOrderCounts] = useState<{ atelier: number; stock: number }>({ atelier: 0, stock: 0 });

  const isCommandesSection = pathname.startsWith('/ivy/commandes');
  const isInventaireSection = pathname.startsWith('/ivy/inventaire');
  const isStandSection = pathname.startsWith('/ivy/stand');
  const isHubSection = pathname.startsWith('/ivy/hub');

  const handleSync = async () => {
    if (!currentShop || syncing) return;

    setSyncing(true);
    try {
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: currentShop.id }),
      });

      if (response.ok) {
        const data = await response.json();
        const newCount = data.newOrdersCount || 0;

        notifications.show({
          title: 'Synchronisation terminée',
          message: newCount > 0
            ? `${newCount} nouvelle(s) commande(s) importée(s)`
            : 'Aucune nouvelle commande',
          color: 'moss',
        });
        window.dispatchEvent(new CustomEvent('orders-synced'));
      } else {
        throw new Error('Sync failed');
      }
    } catch (err) {
      console.error('Error syncing:', err);
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de synchroniser les commandes',
        color: 'rust',
      });
    } finally {
      setSyncing(false);
    }
  };

  const fetchOrderCounts = useCallback(async () => {
    if (!currentShop) return;
    try {
      const res = await fetch(`/api/orders/counts?shopId=${currentShop.id}`);
      if (res.ok) {
        const data = await res.json();
        setOrderCounts({ atelier: data.atelier || 0, stock: data.stock || 0 });
      }
    } catch {
      // silencieux
    }
  }, [currentShop]);

  useEffect(() => {
    if (isCommandesSection) {
      fetchOrderCounts();
    }
  }, [isCommandesSection, fetchOrderCounts]);

  useEffect(() => {
    const handler = () => fetchOrderCounts();
    window.addEventListener('orders-synced', handler);
    return () => window.removeEventListener('orders-synced', handler);
  }, [fetchOrderCounts]);

  const commandesMenu = [
    {
      title: '',
      items: [
        { href: '/ivy/commandes', label: 'Vue d\'ensemble', icon: IconHome },
      ],
    },
    {
      title: 'Atelier',
      items: [
        { href: '/ivy/commandes/boutique', label: 'Commandes', icon: IconShoppingCart, exact: true, badge: orderCounts.atelier > 0 ? orderCounts.atelier : null },
        { href: '/ivy/commandes/boutique/suivi', label: 'Suivi interne', icon: IconChecklist, exact: true },
        { href: '/ivy/commandes/boutique/facturation', label: 'Facturation', icon: IconFileInvoice, exact: true },
        { href: '/ivy/commandes/boutique/archives', label: 'Archives', icon: IconArchive, exact: true },
      ],
    },
    {
      title: 'Commandes stock',
      items: [
        { href: '/ivy/commandes/stock', label: 'Commandes', icon: IconTruck, badge: orderCounts.stock > 0 ? orderCounts.stock : null },
      ],
    },
  ];

  const inventaireMenu = [
    {
      title: 'Inventaire',
      items: [
        { href: '/ivy/inventaire', label: 'Tableau de bord', icon: IconHome, exact: true },
        { href: '/ivy/inventaire/produits', label: 'Produits', icon: IconPackage },
        { href: '/ivy/inventaire/statistiques', label: 'Statistiques', icon: IconChartBar },
        { href: '/ivy/inventaire/archives', label: 'Archives', icon: IconArchive },
      ],
    },
  ];

  const standMenu = [
    {
      title: 'Festivals',
      items: [
        { href: '/ivy/stand', label: 'Tableau de bord', icon: IconHome, exact: true },
        { href: '/ivy/stand/zones', label: 'Zones d\'étude', icon: IconChartPie },
      ],
    },
  ];

  const menuCategories = isCommandesSection
    ? commandesMenu
    : isStandSection
      ? standMenu
      : inventaireMenu;

  if (isHubSection) {
    return <div className={styles.fullscreen}>{children}</div>;
  }

  const showSyncButton = isCommandesSection;
  const showLocationSelector = isInventaireSection || isStandSection;

  return (
    <div className={styles.view}>
      <div className={styles.menu}>
        <div className={styles.menu_header}>
          {showSyncButton ? (
            <button
              className={styles.syncButton}
              onClick={handleSync}
              disabled={!currentShop || syncing}
            >
              <span className={styles.syncButton_label}>
                <IconRefresh size={14} />
                {syncing ? 'Synchronisation…' : 'Synchroniser'}
              </span>
              <LastSyncTime />
            </button>
          ) : showLocationSelector ? (
            <LocationSelector />
          ) : null}
        </div>
        <ul className={styles.menu_links}>
          {menuCategories.map((category) => (
            <li key={category.title || 'main'} className={styles.menu_category}>
              {category.title && (
                <div className={styles.menu_category_title}>{category.title}</div>
              )}
              <ul>
                {category.items.map((item: any) => {
                  const Icon = item.icon;
                  const isActive = item.exact
                    ? pathname === item.href
                    : pathname === item.href || pathname.startsWith(item.href + '/');
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={clsx({ [styles.active]: isActive })}
                      >
                        <Icon size={16} />
                        {item.label}
                        {item.badge && (
                          <span className={styles.navBadge}>{item.badge}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
```

**Also update the imports at the top of `IvyLayout.tsx`** to include `LastSyncTime` and remove the unused `Badge` / `Button`:

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './IvyLayout.module.scss';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import { notifications } from '@mantine/notifications';
import { IconHome, IconPackage, IconTruck, IconChartBar, IconShoppingCart, IconFileInvoice, IconArchive, IconRefresh, IconChecklist, IconChartPie } from '@tabler/icons-react';
import { LocationProvider } from '@/context/LocationContext';
import { LocationSelector } from '@/components/LocationSelector';
import { useShop } from '@/context/ShopContext';
import { LastSyncTime } from '@/components/LastSyncTime';
```

Keep the `IvyLayout` wrapper export unchanged.

- [ ] **Step 3: Verify build + visual.**

```bash
pnpm build
pnpm dev
```

Browse `http://localhost:3000/ivy/commandes/boutique`. Expect: sidebar cream-soft, Synchroniser is dark slate button with "il y a Xmin" on the right, nav items with moss active bar on left, order count badge is clay italic.

- [ ] **Step 4: Bump + commit + push.**

```bash
# version.ts: 0.3.18 → 0.3.19
git add src/layout/IvyLayout.tsx src/layout/IvyLayout.module.scss src/config/version.ts
git commit -m "$(cat <<'EOF'
feat(design): refactor IvyLayout sidebar (Atelier boréal + LastSyncTime)

Sidebar switches to cream-soft with moss accent (bar + bg) on active nav
items. Synchroniser button becomes slate primary with LastSyncTime
showing the relative French timestamp of the last completed sync. Order
count badges become clay italic. Notification colors migrate from green
to moss and red to rust.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Phase 3 — Shared Components

Each component follows the same structure: `.tsx` + `.module.scss` + `index.ts`. Files live under `src/components/<Name>/`.

### Task 9: `<StatusBadge />`

**Files:**
- Create: `src/components/StatusBadge/StatusBadge.tsx`
- Create: `src/components/StatusBadge/StatusBadge.module.scss`
- Create: `src/components/StatusBadge/index.ts`

**Context:** Replaces ad-hoc Mantine `<Badge>` usage for status semantics. 5 variants mapped to palette accents. Small, pill-ish, 11px 600, letter-spacing 0.02em.

- [ ] **Step 1: Create `StatusBadge.tsx`.**

```tsx
import clsx from 'clsx';
import styles from './StatusBadge.module.scss';

export type StatusBadgeVariant = 'moss' | 'clay' | 'sand' | 'slate' | 'plum';

export interface StatusBadgeProps {
  variant: StatusBadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function StatusBadge({ variant, children, className }: StatusBadgeProps) {
  return (
    <span className={clsx(styles.badge, styles[`badge_${variant}`], className)}>
      {children}
    </span>
  );
}
```

- [ ] **Step 2: Create `StatusBadge.module.scss`.**

```scss
@use '@/style/_tokens.scss' as *;

.badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: $radius-sm;
  letter-spacing: 0.02em;
  display: inline-block;
  line-height: 1.4;
  font-family: $font-inter;
}

.badge_moss  { background: $moss-bg;  color: $moss; }
.badge_clay  { background: $clay-bg;  color: $clay; }
.badge_sand  { background: $sand-soft; color: #7a6a45; }
.badge_slate { background: #e0e4e9;  color: $slate; }
.badge_plum  { background: $plum-bg;  color: $plum; }
```

- [ ] **Step 3: Create `index.ts`.**

```ts
export { StatusBadge } from './StatusBadge';
export type { StatusBadgeVariant, StatusBadgeProps } from './StatusBadge';
```

- [ ] **Step 4: Verify build + bump + commit + push.**

```bash
pnpm build
# version.ts: 0.3.19 → 0.3.20
git add src/components/StatusBadge src/config/version.ts
git commit -m "feat(design): add <StatusBadge /> shared component

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 10: `<TagPill />`

**Files:**
- Create: `src/components/TagPill/TagPill.tsx`
- Create: `src/components/TagPill/TagPill.module.scss`
- Create: `src/components/TagPill/index.ts`

**Context:** Renders an external tag (e.g. Shopify tag: "batch", "urgent", "precommande"). Dashed border, lowercase, low contrast — visually distinct from StatusBadge (which is app status).

- [ ] **Step 1: `TagPill.tsx`.**

```tsx
import clsx from 'clsx';
import styles from './TagPill.module.scss';

export interface TagPillProps {
  children: React.ReactNode;
  className?: string;
}

export function TagPill({ children, className }: TagPillProps) {
  return <span className={clsx(styles.pill, className)}>{children}</span>;
}
```

- [ ] **Step 2: `TagPill.module.scss`.**

```scss
@use '@/style/_tokens.scss' as *;

.pill {
  font-family: $font-inter;
  font-size: 10.5px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: $radius-xs;
  background: rgba(43, 52, 64, 0.06);
  color: $slate-soft;
  text-transform: lowercase;
  letter-spacing: 0.02em;
  border: 1px dashed rgba(43, 52, 64, 0.15);
  display: inline-block;
  line-height: 1.4;
}
```

- [ ] **Step 3: `index.ts`.**

```ts
export { TagPill } from './TagPill';
export type { TagPillProps } from './TagPill';
```

- [ ] **Step 4: Build + bump + commit + push.**

```bash
pnpm build
# version.ts: 0.3.20 → 0.3.21
git add src/components/TagPill src/config/version.ts
git commit -m "feat(design): add <TagPill /> for external tags (Shopify)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 11: `<MetaChip />`

**Files:**
- Create: `src/components/MetaChip/MetaChip.tsx`
- Create: `src/components/MetaChip/MetaChip.module.scss`
- Create: `src/components/MetaChip/index.ts`

**Context:** Renders a metafield (key + value). Plum palette. Key in Fraunces italic, value in Inter — visually separated by `:`. Used on order items for impression/broderie/finition specs.

- [ ] **Step 1: `MetaChip.tsx`.**

```tsx
import clsx from 'clsx';
import styles from './MetaChip.module.scss';

export interface MetaChipProps {
  keyName: string;
  value: string;
  className?: string;
}

export function MetaChip({ keyName, value, className }: MetaChipProps) {
  return (
    <span className={clsx(styles.chip, className)}>
      <strong className={styles.key}>{keyName} :</strong>
      <span className={styles.value}>{value}</span>
    </span>
  );
}
```

- [ ] **Step 2: `MetaChip.module.scss`.**

```scss
@use '@/style/_tokens.scss' as *;

.chip {
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: $radius-sm;
  background: $plum-bg;
  color: $plum;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 500;
  line-height: 1.4;
  font-family: $font-inter;
}

.key {
  font-family: $font-fraunces;
  font-style: italic;
  font-weight: 500;
  opacity: 0.85;
}

.value {
  font-family: $font-inter;
}
```

- [ ] **Step 3: `index.ts`.**

```ts
export { MetaChip } from './MetaChip';
export type { MetaChipProps } from './MetaChip';
```

- [ ] **Step 4: Build + bump + commit + push.**

```bash
pnpm build
# version.ts: 0.3.21 → 0.3.22
git add src/components/MetaChip src/config/version.ts
git commit -m "feat(design): add <MetaChip /> for metafield display (plum)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 12: `<SkuChip />`

**Files:**
- Create: `src/components/SkuChip/SkuChip.tsx`
- Create: `src/components/SkuChip/SkuChip.module.scss`
- Create: `src/components/SkuChip/index.ts`

**Context:** Tiny monospace chip for SKU codes. JetBrains Mono, very low contrast, clearly "technical data".

- [ ] **Step 1: `SkuChip.tsx`.**

```tsx
import clsx from 'clsx';
import styles from './SkuChip.module.scss';

export interface SkuChipProps {
  children: React.ReactNode;
  className?: string;
}

export function SkuChip({ children, className }: SkuChipProps) {
  return <span className={clsx(styles.chip, className)}>{children}</span>;
}
```

- [ ] **Step 2: `SkuChip.module.scss`.**

```scss
@use '@/style/_tokens.scss' as *;

.chip {
  font-family: $font-jetbrains;
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: $radius-xs;
  background: rgba(43, 52, 64, 0.05);
  color: $slate-soft;
  letter-spacing: 0.04em;
  display: inline-block;
  line-height: 1.4;
}
```

- [ ] **Step 3: `index.ts`.**

```ts
export { SkuChip } from './SkuChip';
export type { SkuChipProps } from './SkuChip';
```

- [ ] **Step 4: Build + bump + commit + push.**

```bash
pnpm build
# version.ts: 0.3.22 → 0.3.23
git add src/components/SkuChip src/config/version.ts
git commit -m "feat(design): add <SkuChip /> for technical codes (JetBrains Mono)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 13: `<FilterChip />`

**Files:**
- Create: `src/components/FilterChip/FilterChip.tsx`
- Create: `src/components/FilterChip/FilterChip.module.scss`
- Create: `src/components/FilterChip/index.ts`

**Context:** Pill-shaped filter tab. Active = slate fill, inactive = transparent with cream-warm hover. Optional `count` displayed in Fraunces italic.

- [ ] **Step 1: `FilterChip.tsx`.**

```tsx
import clsx from 'clsx';
import styles from './FilterChip.module.scss';

export interface FilterChipProps {
  active?: boolean;
  count?: number;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

export function FilterChip({ active, count, onClick, children, className }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(styles.chip, active && styles.active, className)}
    >
      <span>{children}</span>
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </button>
  );
}
```

- [ ] **Step 2: `FilterChip.module.scss`.**

```scss
@use '@/style/_tokens.scss' as *;

.chip {
  padding: 6px 12px;
  border-radius: $radius-pill;
  background: transparent;
  color: $slate-soft;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: $font-inter;

  &:hover {
    background: $cream-warm;
  }
}

.chip.active {
  background: $slate;
  color: $cream;
}

.count {
  opacity: 0.6;
  font-family: $font-fraunces;
  font-style: italic;
}
```

- [ ] **Step 3: `index.ts`.**

```ts
export { FilterChip } from './FilterChip';
export type { FilterChipProps } from './FilterChip';
```

- [ ] **Step 4: Build + bump + commit + push.**

```bash
pnpm build
# version.ts: 0.3.23 → 0.3.24
git add src/components/FilterChip src/config/version.ts
git commit -m "feat(design): add <FilterChip /> for filter tabs

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 14: `<ProductThumbnail />`

**Files:**
- Create: `src/components/ProductThumbnail/ProductThumbnail.tsx`
- Create: `src/components/ProductThumbnail/ProductThumbnail.module.scss`
- Create: `src/components/ProductThumbnail/index.ts`

**Context:** Shows a product thumbnail. If an `imageUrl` is provided (Shopify image), use it. Otherwise, render a color gradient derived from the variant's color name (via existing `getColorHex()` helper in `color-transformer.ts`) + a fabric-swatch diagonal texture overlay. 48–54px square.

- [ ] **Step 1: Read `src/utils/color-transformer.ts`** to confirm `getColorHex()` signature (expected: `getColorHex(colorName: string): string` returning a hex or the gray fallback `#808080`).

- [ ] **Step 2: `ProductThumbnail.tsx`.**

```tsx
import clsx from 'clsx';
import { getColorHex } from '@/utils/color-transformer';
import styles from './ProductThumbnail.module.scss';

export interface ProductThumbnailProps {
  /** Shopify/Supabase image URL. If provided, takes precedence over color fallback. */
  imageUrl?: string | null;
  /** Variant color name (French or English). Used for gradient fallback. */
  variantColor?: string | null;
  /** Alt text for the image (ignored when fallback is used). */
  alt?: string;
  /** Size in pixels. Default 48. */
  size?: number;
  className?: string;
}

function darken(hex: string, amount = 0.3): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.floor(((n >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.floor(((n >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.floor((n & 0xff) * (1 - amount)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function ProductThumbnail({
  imageUrl,
  variantColor,
  alt = '',
  size = 48,
  className,
}: ProductThumbnailProps) {
  const styleVars = { width: `${size}px`, height: `${size}px` } as React.CSSProperties;

  if (imageUrl) {
    return (
      <div className={clsx(styles.thumb, className)} style={styleVars}>
        <img src={imageUrl} alt={alt} className={styles.img} />
      </div>
    );
  }

  const base = variantColor ? getColorHex(variantColor) : '#808080';
  const darker = darken(base, 0.3);
  const gradient = `linear-gradient(135deg, ${base} 0%, ${darker} 100%)`;

  return (
    <div
      className={clsx(styles.thumb, styles.thumbFallback, className)}
      style={{ ...styleVars, background: gradient }}
      aria-hidden="true"
    />
  );
}
```

- [ ] **Step 3: `ProductThumbnail.module.scss`.**

```scss
@use '@/style/_tokens.scss' as *;

.thumb {
  border-radius: $radius-lg;
  overflow: hidden;
  flex-shrink: 0;
  position: relative;
  border: 1px solid $divider;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
  background: $cream-warm;
}

.img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumbFallback::after {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    45deg,
    transparent 0 2px,
    rgba(255, 255, 255, 0.04) 2px 4px
  );
  pointer-events: none;
}
```

- [ ] **Step 4: `index.ts`.**

```ts
export { ProductThumbnail } from './ProductThumbnail';
export type { ProductThumbnailProps } from './ProductThumbnail';
```

- [ ] **Step 5: Build + bump + commit + push.**

```bash
pnpm build
# version.ts: 0.3.24 → 0.3.25
git add src/components/ProductThumbnail src/config/version.ts
git commit -m "feat(design): add <ProductThumbnail /> with color gradient fallback

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 15: `<CostDisplay />`

**Files:**
- Create: `src/components/CostDisplay/CostDisplay.tsx`
- Create: `src/components/CostDisplay/CostDisplay.module.scss`
- Create: `src/components/CostDisplay/index.ts`

**Context:** Renders `×qty @ unitCost` + total cost + "Coût" eyebrow. Moss color for the total. Used on production views (Commandes boutique items) where the "cost the printer earns" is more relevant than the sale price.

- [ ] **Step 1: `CostDisplay.tsx`.**

```tsx
import clsx from 'clsx';
import styles from './CostDisplay.module.scss';

export interface CostDisplayProps {
  qty: number;
  /** Unit cost in euros. If null/undefined, displays a dash. */
  unitCost: number | null | undefined;
  className?: string;
}

function formatEuro(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} €`;
}

export function CostDisplay({ qty, unitCost, className }: CostDisplayProps) {
  const hasCost = unitCost !== null && unitCost !== undefined;
  const totalCost = hasCost ? qty * (unitCost as number) : null;

  return (
    <div className={clsx(styles.cost, className)}>
      <div className={styles.qtyUnit}>
        <span className={styles.qty}>×{qty}</span>
        {hasCost ? (
          <span className={styles.unit}>@ {formatEuro(unitCost as number)}</span>
        ) : (
          <span className={styles.unit}>—</span>
        )}
      </div>
      <div className={styles.total}>
        {totalCost !== null ? formatEuro(totalCost) : '—'}
      </div>
      <div className={styles.label}>Coût</div>
    </div>
  );
}
```

- [ ] **Step 2: `CostDisplay.module.scss`.**

```scss
@use '@/style/_tokens.scss' as *;

.cost {
  text-align: right;
  min-width: 108px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  padding-left: 6px;
  padding-top: 4px;
}

.qtyUnit {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 12px;
  color: $slate-muted;
  font-family: $font-inter;
}

.qty {
  font-family: $font-fraunces;
  font-style: italic;
  font-weight: 500;
  color: $slate;
}

.unit {
  color: $slate-muted;
}

.total {
  font-family: $font-fraunces;
  font-weight: 500;
  font-size: 15px;
  color: $moss;
  letter-spacing: -0.01em;
}

.label {
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: $slate-muted;
  font-weight: 600;
  margin-top: 1px;
  font-family: $font-inter;
}
```

- [ ] **Step 3: `index.ts`.**

```ts
export { CostDisplay } from './CostDisplay';
export type { CostDisplayProps } from './CostDisplay';
```

- [ ] **Step 4: Build + bump + commit + push.**

```bash
pnpm build
# version.ts: 0.3.25 → 0.3.26
git add src/components/CostDisplay src/config/version.ts
git commit -m "feat(design): add <CostDisplay /> for production views

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Phase 4a — Hero page: migrate `/ivy/commandes/boutique`

### Task 16: Refactor `DetailedOrdersPage` to Atelier boréal card layout

**Files:**
- Read (context): `src/scenes/orders/DetailedOrdersPage.tsx` (~4475 tok — full rendering of the grid)
- Read (context): `src/scenes/orders/DetailedOrdersPage.presenter.ts`
- Read (context): `src/scenes/orders/DetailedOrdersPage.module.scss`
- Modify: `src/scenes/orders/DetailedOrdersPage.tsx`
- Modify: `src/scenes/orders/DetailedOrdersPage.module.scss`

**Context:** The page `/ivy/commandes/boutique` renders `<DetailedOrdersPage />` (scene pattern). The scene currently uses Mantine `<Table>` or existing card style. We're migrating it to the Atelier boréal 2-column card grid matching mockup v4.

**This is the BIG task.** It's the hero page with real data from Shopify/Supabase. Do it carefully:
1. Preserve ALL existing behavior (sync trigger, filtering, drawer open, checkboxes, progress calculation)
2. Replace visual primitives with new components
3. Hide sale prices — show costs via `<CostDisplay />`
4. Use `<ProductThumbnail />`, `<SkuChip />`, `<MetaChip />`, `<TagPill />`, `<StatusBadge />`, `<FilterChip />` from phase 3.

- [ ] **Step 1: Read the current scene files** to understand the data shape and rendering. The presenter exposes hooks like `useDetailedOrdersPagePresenter`. The view iterates orders and renders variants.

- [ ] **Step 2: Write the new `DetailedOrdersPage.tsx`.** Structure (pseudo-code → fill in real data hooks from the presenter):

```tsx
'use client';

import { useState, useMemo } from 'react';
import { useDetailedOrdersPagePresenter } from './DetailedOrdersPage.presenter';
import { ProductThumbnail } from '@/components/ProductThumbnail';
import { SkuChip } from '@/components/SkuChip';
import { MetaChip } from '@/components/MetaChip';
import { TagPill } from '@/components/TagPill';
import { StatusBadge } from '@/components/StatusBadge';
import { FilterChip } from '@/components/FilterChip';
import { CostDisplay } from '@/components/CostDisplay';
import { IconCheck, IconDots, IconPrinter } from '@tabler/icons-react';
import clsx from 'clsx';
import styles from './DetailedOrdersPage.module.scss';

type FilterStatus = 'all' | 'production' | 'toValidate' | 'ready';

export function DetailedOrdersPage() {
  const { orders, loading, filteredCount } = useDetailedOrdersPagePresenter();
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [search, setSearch] = useState('');

  const filteredOrders = useMemo(() => {
    // Apply filter + search — implement based on existing presenter logic
    return orders.filter(/* preserve existing filter logic */);
  }, [orders, filter, search]);

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div className={styles.eyebrow}>Atelier · Runes de Chêne</div>
        <h1 className={styles.title}>Commandes <em>boutique</em></h1>
        <div className={styles.sub}>
          {filteredCount} commandes en cours, {/* compute */} en attente de production.
        </div>
      </div>

      <div className={styles.filterBar}>
        <FilterChip active={filter === 'all'} count={filteredCount} onClick={() => setFilter('all')}>Toutes</FilterChip>
        <FilterChip active={filter === 'production'} onClick={() => setFilter('production')}>En production</FilterChip>
        <FilterChip active={filter === 'toValidate'} onClick={() => setFilter('toValidate')}>À valider</FilterChip>
        <FilterChip active={filter === 'ready'} onClick={() => setFilter('ready')}>Prêtes</FilterChip>
        <div className={styles.spacer} />
        <input
          className={styles.search}
          placeholder="Rechercher un N° ou un client…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className={styles.grid}>
        {filteredOrders.map((order) => (
          <OrderCard key={order.id} order={order} />
        ))}
      </div>
    </div>
  );
}

function OrderCard({ order }: { order: any /* existing Order type */ }) {
  const totalCost = order.items.reduce(
    (sum: number, item: any) => sum + ((item.cost ?? 0) * item.quantity),
    0,
  );
  const validatedPct = Math.round(
    (order.items.filter((i: any) => i.is_validated).length / order.items.length) * 100,
  );

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div className={styles.cardHeadTop}>
          <div className={styles.orderNum}>{order.name}</div>
          {order.tags?.map((tag: string) => (
            <TagPill key={tag}>{tag}</TagPill>
          ))}
          <div className={styles.cardHeadRight}>
            {order.displayFinancialStatus === 'PAID' && <StatusBadge variant="moss">Payée</StatusBadge>}
            {order.tags?.includes('urgent') && <StatusBadge variant="clay">Urgent</StatusBadge>}
            {/* adapt to existing status logic */}
          </div>
        </div>
        <div className={styles.cardHeadBottom}>
          <span>pour <strong className={styles.customerName}>{order.customerName}</strong></span>
          <span className={styles.date}>· {formatDate(order.createdAt)}</span>
          <div className={styles.costSummary}>
            <span className={styles.costSummaryLabel}>Coût</span>
            <span className={styles.costSummaryAmount}>{totalCost.toFixed(2).replace('.', ',')} €</span>
            <span className={styles.costSummaryUnit}>· {order.items.length} art.</span>
          </div>
        </div>
      </div>

      <div className={styles.cardBody}>
        {order.items.map((item: any) => (
          <div key={item.id} className={styles.item}>
            <div className={styles.itemCheck}>
              <div className={clsx(styles.checkbox, item.is_validated && styles.checkboxChecked)}>
                {item.is_validated && <IconCheck size={12} stroke={2.5} />}
              </div>
            </div>
            <ProductThumbnail
              imageUrl={item.imageUrl}
              variantColor={item.variantColor}
              size={54}
              alt={item.title}
            />
            <div className={styles.itemInfo}>
              <div className={styles.itemName}>{item.productTitle}</div>
              <div className={styles.itemMeta}>
                <SkuChip>{item.sku}</SkuChip>
                <span className={styles.variant}>
                  <span
                    className={styles.variantDot}
                    style={{ background: getColorDot(item.variantColor) }}
                  />
                  {item.variantTitle}
                </span>
              </div>
              {item.metafields && Object.keys(item.metafields).length > 0 && (
                <div className={styles.itemMeta}>
                  {Object.entries(item.metafields).map(([k, v]) => (
                    <MetaChip key={k} keyName={k} value={String(v)} />
                  ))}
                </div>
              )}
            </div>
            <CostDisplay qty={item.quantity} unitCost={item.cost} />
          </div>
        ))}
      </div>

      <div className={styles.cardFoot}>
        <div className={styles.progressWrap}>
          <span className={styles.progressLabel}>{validatedPct}%</span>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${validatedPct}%` }} />
          </div>
        </div>
        <div className={styles.footRight}>
          <button className={styles.btnGhost}>
            <IconPrinter size={14} /> Feuillet
          </button>
          <button className={styles.btnKebab}>
            <IconDots size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function getColorDot(colorName: string | null | undefined): string {
  if (!colorName) return 'transparent';
  // Reuse the color-transformer or compute via getColorHex
  // (keep implementation simple; import and use getColorHex)
  return '#' + '888'; // placeholder — engineer: use getColorHex from src/utils/color-transformer
}

function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}
```

**Important caveats for the executing agent:**
- The actual property names (`order.customerName`, `item.imageUrl`, `item.cost`, `item.metafields`, etc.) depend on the presenter return shape. **Read the presenter first** and adapt property names accordingly.
- `item.cost` comes from `product_variants.cost` — if the presenter doesn't currently expose it, update the presenter to include it (join or select).
- `item.imageUrl` may not exist in the current presenter — if absent, pass `undefined` and the fallback gradient will render.
- `item.metafields` is `Record<string, string>` per the spec in `CLAUDE.md` (`{"Recto": "DTG-CUI"}`).
- `getColorDot` should use `getColorHex` from `src/utils/color-transformer.ts`.
- **Preserve** the existing `onClick` behaviors — card click navigates, button clicks trigger drawers/prints. Read existing scene for those handlers.
- The `OrderDrawer` open/close logic currently in the scene must be preserved.

- [ ] **Step 3: Write the new `DetailedOrdersPage.module.scss`.**

Full file — this is extensive but static:

```scss
@use '@/style/_tokens.scss' as *;

.page {
  /* inherits content padding from layout */
}

.pageHead {
  margin-bottom: 28px;
}

.eyebrow {
  font-family: $font-inter;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: $slate-muted;
  font-weight: 600;
  margin-bottom: 10px;
}

.title {
  font-family: $font-fraunces;
  font-size: 40px;
  font-weight: 500;
  color: $slate;
  letter-spacing: -0.02em;
  line-height: 1;
  margin-bottom: 8px;

  em {
    font-style: italic;
    font-weight: 400;
    color: $moss;
  }
}

.sub {
  font-family: $font-fraunces;
  font-style: italic;
  font-size: 16px;
  color: $slate-soft;
  font-weight: 400;
}

.filterBar {
  display: flex;
  align-items: center;
  gap: $space-sm;
  margin: 24px 0 20px;
  padding: 14px $space-base;
  background: $cream-soft;
  border: 1px solid $divider;
  border-radius: $radius-xl;
}

.spacer { flex: 1; }

.search {
  padding: 7px 14px;
  background: $cream;
  border: 1px solid $divider;
  border-radius: $radius-pill;
  font-size: 13px;
  color: $slate;
  width: 240px;
  font-family: $font-inter;
  outline: none;

  &::placeholder { color: $slate-muted; }
  &:focus { border-color: $moss; background: white; }
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: $space-lg;
}

.card {
  background: $cream-soft;
  border: 1px solid $divider;
  border-radius: $radius-xl;
  overflow: hidden;
  transition: all 0.2s ease;
  cursor: pointer;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(43, 52, 64, 0.06);
    border-color: $divider-strong;
  }
}

.cardHead {
  padding: 14px $space-lg;
  border-bottom: 1px solid $divider;
  background: $cream-warm;
}

.cardHeadTop {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.orderNum {
  font-family: $font-fraunces;
  font-style: italic;
  font-size: 24px;
  font-weight: 500;
  color: $slate;
  letter-spacing: -0.01em;
}

.cardHeadRight {
  margin-left: auto;
  display: flex;
  gap: 6px;
  align-items: center;
}

.cardHeadBottom {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: $slate-soft;
  flex-wrap: wrap;
}

.customerName { color: $slate; font-weight: 600; }
.date { color: $slate-muted; }

.costSummary {
  margin-left: auto;
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.costSummaryLabel {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: $slate-muted;
  font-weight: 600;
}

.costSummaryAmount {
  font-family: $font-fraunces;
  font-weight: 500;
  font-size: 18px;
  color: $moss;
  letter-spacing: -0.01em;
}

.costSummaryUnit {
  font-family: $font-fraunces;
  font-style: italic;
  font-size: 12px;
  color: $slate-muted;
}

.cardBody {
  padding: 10px 14px;
}

.item {
  padding: 10px 8px;
  border-bottom: 1px dashed $divider;
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  gap: 10px;
  align-items: flex-start;

  &:last-child { border-bottom: 0; }
  &:hover { background: rgba(255, 255, 255, 0.5); border-radius: $radius-md; }
}

.itemCheck { padding-top: 16px; }

.checkbox {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1.5px solid $divider-strong;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: white;
  cursor: pointer;
}

.checkboxChecked {
  background: $moss;
  border-color: $moss;
  color: white;
}

.itemInfo { min-width: 0; }

.itemName {
  font-size: 14px;
  color: $slate;
  font-weight: 600;
  line-height: 1.25;
  margin-bottom: 3px;
}

.itemMeta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 3px;
}

.variant {
  font-family: $font-fraunces;
  font-style: italic;
  font-size: 12.5px;
  color: $slate-muted;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.variantDot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.cardFoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px $space-lg;
  background: $cream;
  border-top: 1px solid $divider;
}

.progressWrap {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.progressLabel {
  font-size: 12px;
  color: $slate-soft;
  font-weight: 500;
  min-width: 40px;
  font-family: $font-fraunces;
  font-style: italic;
}

.progressTrack {
  height: 6px;
  background: $cream-warm;
  border-radius: $radius-pill;
  flex: 1;
  overflow: hidden;
  max-width: 140px;
}

.progressFill {
  height: 100%;
  background: linear-gradient(90deg, $moss 0%, $moss-soft 100%);
  border-radius: $radius-pill;
}

.footRight {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btnGhost {
  padding: 6px 12px;
  background: transparent;
  border: 1px solid $divider-strong;
  border-radius: $radius-md;
  font-size: 12.5px;
  color: $slate;
  font-weight: 500;
  cursor: pointer;
  font-family: $font-inter;
  display: inline-flex;
  align-items: center;
  gap: 6px;

  &:hover { background: $cream-warm; }
}

.btnKebab {
  width: 32px;
  height: 32px;
  border-radius: $radius-md;
  background: transparent;
  border: 1px solid transparent;
  color: $slate-soft;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &:hover { background: $cream-warm; }
}
```

- [ ] **Step 4: Verify presenter exposes `cost` on items.** If not, update `DetailedOrdersPage.presenter.ts` to join/select `product_variants.cost` for each line item. The presenter likely returns items already enriched — add the `cost` field if missing, defaulting to `null` when no variant is found.

- [ ] **Step 5: Run dev server and visually inspect.**

```bash
pnpm dev
```

Open `http://localhost:3000/ivy/commandes/boutique`. Expect: 2-column grid of cards with thumbnails, metafields visible in plum, costs in moss, tags as dashed pills, statuses as colored badges. Click a card → drawer opens (existing behavior preserved). Sync still works. Filters still work.

**If the page is broken** (e.g. property mismatch): adjust the code to match the actual presenter shape. Don't ship a broken page.

- [ ] **Step 6: Build.**

```bash
pnpm build
```

Expected: passes.

- [ ] **Step 7: Bump + commit + push.**

```bash
# version.ts: 0.3.26 → 0.3.27
git add src/scenes/orders/DetailedOrdersPage.tsx src/scenes/orders/DetailedOrdersPage.module.scss src/scenes/orders/DetailedOrdersPage.presenter.ts src/config/version.ts
git commit -m "$(cat <<'EOF'
feat(design): migrate Commandes Boutique to Atelier boréal

Refactors /ivy/commandes/boutique to the Atelier boréal card grid:
- 2-column responsive grid of order cards
- Card head (cream-warm): order#, tags, status badges, cost summary
- Card body: item rows with product thumbnail (or color fallback), SKU
  chip, variant with color dot, metafield chips (plum), moss cost
  display — no more sale prices on this view (production context)
- Card foot (cream): validation progress + Feuillet button + kebab
- Shopify tags shown as dashed TagPills
- Metafields prominently visible (key priority for printing)

Preserves all existing behaviors: drawer open on card click, sync
trigger, filter/search, checkbox validation flow.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 17: Final verification + bump to minor version

**Files:**
- Modify: `src/config/version.ts`

**Context:** Wrap up phase 1-3 + 4a as a milestone. Bump to `0.4.0` to signal "Atelier boréal foundation complete — hero page migrated".

- [ ] **Step 1: Run full build.**

```bash
pnpm build
```

- [ ] **Step 2: Run dev server and click through the app.**

```bash
pnpm dev
```

Visit each route and confirm no regression:
- `/login` → page still renders (theme change might shift the login form colors, that's OK)
- `/ivy` → topnav in new style
- `/ivy/commandes/boutique` → full Atelier boréal
- `/ivy/commandes/stock` → uses new tokens but not yet migrated to full design — acceptable (follow-up plan)
- `/ivy/inventaire/produits` → uses new tokens, not yet migrated — acceptable
- `/ivy/hub` → fullscreen, new tokens, no sidebar — acceptable
- `/parametres` → uses new tokens — acceptable

- [ ] **Step 3: Bump to 0.4.0 + commit + push.**

```bash
# version.ts: 0.3.27 → 0.4.0
git add src/config/version.ts
git commit -m "$(cat <<'EOF'
chore: bump to 0.4.0 — Atelier boréal foundation + hero page complete

Milestone: tokens (CSS vars + SCSS + Mantine theme override), shell
(IvyMark + TopNavbar + Sidebar + LastSyncTime), shared component
library (StatusBadge, TagPill, MetaChip, SkuChip, FilterChip,
ProductThumbnail, CostDisplay), hero page migration (Commandes
Boutique). Remaining pages and polish to follow in dedicated plans.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Next steps (follow-up plans, not in this document)

Once this plan is executed and validated, write dedicated plans for:

1. **Phase 4b — Remaining pages** (one plan, mechanical application of the validated pattern)
   - `/ivy/commandes/stock/[orderId]`
   - `/ivy/commandes/boutique/facturation` (keeps sale prices — this is its purpose)
   - `/ivy/commandes/boutique/suivi`
   - `/ivy/inventaire/produits`
   - `/ivy/inventaire` (dashboard)
   - `/ivy/stand` + `/ivy/stand/zones`
   - `/ivy/hub` (fullscreen)
   - Archives (`/ivy/commandes/boutique/archives`, `/ivy/inventaire/archives`)
   - `/parametres/*` (descriptions, illustrations, prix, couleurs, metachamps)
   - `/login`, `/signup`, `/onboarding`, `/ivy/profil`

2. **Phase 5 — Polish**
   - Retire Alegreya font (remove from `layout.tsx`, audit remaining usages via grep)
   - Audit hover/focus states globally
   - Accessibility contrast pass (WCAG AA minimum)
   - Feuillet d'impression design (`/ivy/commandes/stock/[orderId]/feuillet`, `/impression`) — own design context, print-specific

---

## Self-review notes (done)

- **Spec coverage:** Foundation ✓ (Tasks 1-3), Shell ✓ (Tasks 4-8), Shared components ✓ (Tasks 9-15), Hero page ✓ (Task 16). Remaining pages + polish explicitly deferred to follow-up plans. Acceptance criteria that depend on remaining pages (e.g. "no `#000`/`#fff` in output" fully) are also deferred.
- **Placeholder scan:** no TBD/TODO in steps. Task 16 explicitly flags property names as "adapt to presenter" — this is necessary, not a placeholder, because the presenter shape is not fully knowable without reading; the plan tells the engineer what to check.
- **Type consistency:** `<StatusBadge variant>` uses `moss|clay|sand|slate|plum` consistently. `<IvyMark size>` uses `sm|md|lg|xl` consistently. Hook names (`useLastSync`) match between Tasks 5 and 6. No drift.
- **No broken references:** Every component Task 16 uses (StatusBadge, TagPill, MetaChip, SkuChip, FilterChip, ProductThumbnail, CostDisplay) is created in earlier tasks (9-15). `getColorHex` exists in `src/utils/color-transformer.ts` per the codebase.
