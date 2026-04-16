# Ivy · Atelier Boréal — Phase 4b + 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Apply Atelier boréal identity to the 10 remaining Ivy pages (Phase 4b) + the 2 print pages (Phase 5) + retire Alegreya. After this plan, every visible surface of Ivy follows the Atelier boréal system.

**Architecture:** Re-use the foundation (Phases 1-3 shipped at `0.4.0`). Most tasks are **"tokens passes"** — swap hardcoded Mantine colors (`color="orange/green/red"`) for Atelier palette (`slate/moss/rust/clay`), replace ad-hoc `<Badge>` with `<StatusBadge>`, wrap pages in cream backgrounds, apply Fraunces italic to titles. A few pages (stock order detail, HUB, print sheets) need deeper structural refactors similar to what was done on Commandes Boutique.

**Tech Stack:** Same as Phase 1-4a. Shared components available : `<IvyMark>`, `<StatusBadge>`, `<TagPill>`, `<MetaChip>`, `<SkuChip>`, `<FilterChip>`, `<ProductThumbnail>`, `<CostDisplay>`, `<LastSyncTime>`. Tokens: `src/app/globals.scss` + `src/style/_tokens.scss`. Mantine theme at `src/app/layout.tsx`.

**Reference docs:**
- Spec : [`docs/superpowers/specs/2026-04-16-ivy-atelier-boreal-design.md`](../specs/2026-04-16-ivy-atelier-boreal-design.md)
- Design system prompt : [`/ATELIER_BOREAL.md`](../../../ATELIER_BOREAL.md)
- Foundation plan (already shipped) : [`2026-04-16-ivy-atelier-boreal-foundation.md`](./2026-04-16-ivy-atelier-boreal-foundation.md)
- Hero page reference implementation : `src/scenes/orders/DetailedOrdersPage.tsx` + `.module.scss`

**Verification strategy:** `pnpm build` + `pnpm dev` manual smoke (navigate the page, verify no Mantine orange/green/red leaking, no white raw backgrounds, typography uses Fraunces for titles).

**Commit convention:** Each task commits AND pushes AND bumps patch version. Final task (Task 14) bumps to minor `0.5.0`.

**Color migration cheatsheet** (reuse across all tasks):

| Old | New |
|---|---|
| `color="orange"` (urgency/emphasis) | `color="clay"` or `<StatusBadge variant="clay">` |
| `color="green"` (success/paid/valid) | `color="moss"` or `<StatusBadge variant="moss">` |
| `color="red"` (error/destructive) | `color="rust"` or `<StatusBadge variant="rust">` — BUT rust is not in the Mantine custom palette; use `color="rust"` only where we registered it. Otherwise use inline `style={{ color: 'var(--rust)' }}` |
| `color="blue"` (info) | `color="slate"` or `color="plum"` if it's a metafield/category signal |
| `color="yellow"` / `color="gold"` (pending/warning) | `<StatusBadge variant="sand">` or `color="sand"` |
| `backgroundColor: '#fff'` / `background: 'white'` | `var(--cream-soft)` |
| `background: '#f5f5f5'` / `#fafafa` / `#f9f9f9` | `var(--cream)` |
| `color: '#000'` / body text | `var(--ink)` |
| Gray borders `#e0e0e0` / `#ddd` etc. | `var(--divider)` or `var(--divider-strong)` |
| Mantine `<Badge>` with color prop | `<StatusBadge variant="...">` (import from `@/components/StatusBadge`) |

**For all tasks: use `@use '@/style/_tokens.scss' as *;` at the top of any SCSS file being rewritten**, so `$cream`, `$moss`, etc. are available.

---

## Phase 4b — Part 1 : Commandes

### Task 1: Migrate Stock order detail page

**Files:**
- Modify: `src/app/ivy/commandes/stock/[orderId]/page.tsx` (~14k tokens — large page)
- Modify: `src/app/ivy/commandes/stock/[orderId]/order-detail.module.scss`

**Context:** This is the supplier/stock order detail page — very similar to Commandes Boutique detail, but operates on `supplier_orders` + `supplier_order_items` tables instead of Shopify orders. Features: items list, per-item validation checkboxes, metafields, line adjustments, stock status badges (added/failed/null), "Terminer et ajouter au stock" button (uses stock-stream API — DON'T TOUCH the logic, only the styling).

**Critical preservation:**
- The `retryFailedStock` flow (that we fixed in a previous session) must keep working
- Checkbox validation flow (Supabase `supplier_order_items.is_validated`)
- Status badges reflecting `stock_status` values ('added' | 'failed' | null when validated)
- Balance adjustment, subtotal, total HT/TTC (sale prices KEEP on this page — it's billing-adjacent)
- Add/delete/validate line items
- Kebab or Modal-open actions (recalculer prix, rafraîchir métachamps, etc.)

**Styling changes:**
- Page shell: cream background (inherited from layout)
- Page head: eyebrow "Atelier · Runes de Chêne" in Inter uppercase, H1 "Commande stock" in Fraunces with italic accent, sub in Fraunces italic
- Status badges: use `<StatusBadge>`:
  - Order status : `draft` → `variant="slate"`, `requested` → `variant="plum"`, `produced` → `variant="moss"`, `completed` → `variant="moss"` with an extra check icon
  - Stock status per item: `added` → `moss`, `failed` → `clay` (or inline rust text), null+validated → `sand`
- Items table/list: prefer a cards layout similar to hero page — one card per SKU group with items stacked. But if the existing table is tight and works, tokens-pass only (cream-soft bg, Fraunces italic for SKU/quantities, plum `<MetaChip>` for metafields, `<SkuChip>` for SKUs)
- Buttons (Ajouter articles, Sauvegarder, Passer en X, Terminer et ajouter au stock): replace Mantine color props with `slate` (primary actions), `moss` (validate/complete positive), `rust` (delete)
- Modals: restyle to cream-soft with Fraunces italic titles

**Bigger refactor bonus (optional but nice):** Move "Recalculer les prix", "Rafraîchir métachamps" into a kebab next to the primary "Sauvegarder" button (following the Commandes Boutique pattern).

- [ ] **Step 1:** Read the current page thoroughly (it's 14k tokens — take time).
- [ ] **Step 2:** Read the already-migrated hero page (`src/scenes/orders/DetailedOrdersPage.tsx`) for the pattern reference.
- [ ] **Step 3:** Apply the styling changes — don't change business logic.
- [ ] **Step 4:** Verify the page renders in `pnpm dev` at `/ivy/commandes/stock/[any-id]`. Test at least: create an order, add items, validate some, check "Terminer et ajouter au stock" button behavior isn't broken.
- [ ] **Step 5:** `pnpm build` must pass.
- [ ] **Step 6:** Bump `src/config/version.ts` 0.4.0 → 0.4.1.
- [ ] **Step 7:** Commit + push:

```bash
git add src/app/ivy/commandes/stock/[orderId]/page.tsx src/app/ivy/commandes/stock/[orderId]/order-detail.module.scss src/config/version.ts
git commit -m "$(cat <<'EOF'
feat(design): migrate stock order detail page to Atelier boréal

- Page head with eyebrow + Fraunces italic title
- StatusBadge variants for order + per-item stock status
- SkuChip / MetaChip for item details
- Buttons use slate/moss/rust palette (no more orange/green/red)
- Preserves add-to-stock stream flow, retry flow, checkbox validation,
  line adjustment input

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 2: Migrate Facturation boutique page

**Files:**
- Modify: `src/app/ivy/commandes/boutique/facturation/page.tsx`
- Modify: `src/app/ivy/commandes/boutique/facturation/facturation.module.scss`

**Context:** Monthly billing view. Shows orders + total per month + weekly invoices + `<MonthlyInvoiceButton>` + `<WeeklyBillingCheckbox>` + `<MonthlyBillingNote>`. **Keep ALL sale prices, line totals, TTC/HT totals — this is billing, it's its raison d'être.**

**Styling changes:**
- Page head: eyebrow "Atelier · Runes de Chêne", H1 "Facturation" in Fraunces with italic "mensuelle" accent, sub in Fraunces italic
- Month tabs or selector: use `<FilterChip>` instead of Mantine Tabs/SegmentedControl
- Table: if it's a Mantine `<Table>`, add a `className` applying cream-soft rows with cream-warm hover, Fraunces italic for monetary cells and order numbers, moss color for totals (payé/validé), sand for "en attente"
- `<MonthlyInvoiceButton>` component: restyle internally to slate primary (file: `src/components/MonthlyInvoiceButton.tsx`)
- Weekly billing checkboxes: use `<StatusBadge>` + moss checkmark
- Monthly note textareas: cream-soft bg, moss focus border
- All `color="green"` etc. → appropriate Atelier palette

- [ ] **Step 1:** Read current facturation page + related components (`MonthlyInvoiceButton`, `WeeklyBillingCheckbox`, `MonthlyBillingNote`).
- [ ] **Step 2:** Apply tokens + component swaps.
- [ ] **Step 3:** Also restyle `src/components/MonthlyInvoiceButton.tsx` if it has hardcoded colors (it does — check).
- [ ] **Step 4:** `pnpm build` + `pnpm dev` smoke at `/ivy/commandes/boutique/facturation`.
- [ ] **Step 5:** Bump 0.4.1 → 0.4.2.
- [ ] **Step 6:** Commit + push with message:

```
feat(design): migrate facturation boutique to Atelier boréal
- Fraunces italic for monetary cells, H1 title
- FilterChip for month selector
- Restyled MonthlyInvoiceButton (slate primary)
- Sale prices preserved (this view is for billing)
```

---

### Task 3: Migrate Suivi interne page

**Files:**
- Modify: `src/app/ivy/commandes/boutique/suivi/page.tsx`
- Modify: `src/app/ivy/commandes/boutique/suivi/suivi.module.scss`

**Context:** Internal tracking view — lighter than boutique. Shows a simplified list of orders and their progress. May reuse `<TextileProgress>`.

**Styling changes:**
- Page head with eyebrow + Fraunces title "Suivi interne"
- List/table: cream-soft rows, Fraunces italic for order numbers
- Progress bars: moss gradient (same as hero)
- `<TextileProgress>` component may need restyling (file: `src/components/TextileProgress/TextileProgress.tsx`) — check for hardcoded colors
- Checkboxes: moss-filled when checked
- Any "color=X" Mantine calls: migrate

- [ ] **Step 1:** Read page + TextileProgress component.
- [ ] **Step 2:** Apply token pass. If TextileProgress has hardcoded green/orange, update its internal SCSS to use `$moss` / `$clay`.
- [ ] **Step 3:** Build + smoke test.
- [ ] **Step 4:** Bump 0.4.2 → 0.4.3, commit+push.

---

### Task 4: Migrate Archives boutique

**Files:**
- Modify: `src/scenes/orders/ArchivedOrdersPage.tsx` + `.presenter.ts` if needed
- Modify: any related SCSS

**Context:** Shows fulfilled/archived orders. Similar to boutique but read-only. Should follow the SAME card grid pattern as Commandes Boutique — the visual consistency matters. Cards displayed with "Archivée" `<StatusBadge variant="slate">`, no interactive checkboxes, possibly a link to view the order details.

**Styling changes:**
- Card grid 2 columns (same as hero page)
- Page head eyebrow "Archives · Runes de Chêne", H1 "Archives" Fraunces + italic "boutique"
- Cards: same structure as hero but simplified foot (no progress bar since all are 100%, just "Détails" button + kebab)
- `<StatusBadge variant="slate">` for "Archivée" label
- Status "Remboursée" → `<StatusBadge variant="rust">`
- No sale prices shown (same reason as Commandes Boutique — production perspective). Keep cost via `<CostDisplay>` if data allows; otherwise just show items without numeric column.

**Option:** Reuse as much of the `<OrderCard>` component from `DetailedOrdersPage` as possible. If it's trivially extractable into a shared component, do it. If not, duplicate and simplify.

- [ ] **Step 1:** Read current ArchivedOrdersPage scene.
- [ ] **Step 2:** Decide: extract OrderCard to shared or duplicate. If extracting, create `src/scenes/orders/OrderCard.tsx` + `.module.scss` and import from both scenes.
- [ ] **Step 3:** Apply migration.
- [ ] **Step 4:** Build + smoke at `/ivy/commandes/boutique/archives`.
- [ ] **Step 5:** Bump 0.4.3 → 0.4.4, commit+push.

---

### Task 5: Migrate Archives inventaire

**Files:**
- Modify: `src/app/ivy/inventaire/archives/page.tsx`

**Context:** Shows archived products. Small-medium page. Uses a list or table.

**Styling changes:**
- Page head: eyebrow "Inventaire · Runes de Chêne", H1 Fraunces "Archives" with italic "produits"
- List/cards: cream-soft with slate divider
- Any Mantine `<Badge>` → `<StatusBadge>`
- Actions "Restaurer" button → moss variant; "Supprimer définitivement" → rust variant

Token pass, straightforward.

- [ ] Steps 1-4 as above. Bump 0.4.4 → 0.4.5.

---

## Phase 4b — Part 2 : Inventaire

### Task 6: Migrate Inventaire produits (product catalog)

**Files:**
- Modify: `src/app/ivy/inventaire/produits/page.tsx`
- Modify: `src/app/ivy/inventaire/produits/inventory.module.scss`
- Modify: `src/components/Inventory/ProductCard.tsx` + `.module.scss`
- Modify: `src/components/Inventory/ProductDetailView.tsx` + `.module.scss`
- Modify: `src/components/Inventory/ProductDetailPanel.tsx` + `.module.scss`
- Modify: `src/components/Inventory/SortableOptionChip.tsx` + `.module.scss`
- Modify: `src/components/Inventory/SortOptionsBar.tsx` + `.module.scss`
- Modify: `src/components/ProductsManagement/ProductsManagement.tsx`

**Context:** Product catalog — the biggest shared component cluster. ProductCard is the main visual. ProductDetailView/Panel are the drawer/modal when clicking a product. Uses `<Inventory/>` components.

**Styling changes:**
- ProductCard: cream-soft bg, cream-warm head, Fraunces italic for title, SKU prefix as `<SkuChip>`, Mantine gray variants replaced with `StatusBadge slate`, image (if available) with rounded corners + divider border (match `<ProductThumbnail>` visual)
- ProductDetailView: cream-soft panels, Fraunces title, stock levels per location in moss (good) / clay (low) / rust (empty), variant options as chips
- ProductDetailPanel: drawer with cream-soft bg, Fraunces italic title
- SortableOptionChip: style as filter-chip (pill, slate active)
- SortOptionsBar: filter-bar look (padding, cream-soft, divider)
- ProductsManagement: if it shows a table, card-ify or style table with tokens
- Page head eyebrow "Inventaire · Runes de Chêne", H1 "Produits" Fraunces italic

This is the second-biggest page after stock order detail. Take time.

- [ ] **Step 1:** Read all 7 files.
- [ ] **Step 2:** Plan which components need structural change vs tokens pass.
- [ ] **Step 3:** Apply. Consider using `<ProductThumbnail>` for the product image fallback.
- [ ] **Step 4:** Build + smoke at `/ivy/inventaire/produits` (try opening a product panel to see detail view).
- [ ] **Step 5:** Bump 0.4.5 → 0.4.6, commit+push.

---

### Task 7: Migrate Inventaire dashboard + Statistiques

**Files:**
- Modify: `src/app/ivy/inventaire/page.tsx` (dashboard)
- Modify: `src/app/ivy/inventaire/statistiques/page.tsx` (small stub page)

**Context:** Dashboard likely has metric cards, charts. Statistiques may just be placeholders.

**Styling changes:**
- Page head eyebrow + Fraunces H1 for both pages
- Metric cards: cream-soft, Fraunces italic for numbers, Inter uppercase eyebrow for labels
- Chart colors: use Atelier palette (moss, clay, plum, sand) — if Mantine Charts, pass `color="moss"` etc.
- Any `<Badge>` → `<StatusBadge>`

- [ ] Steps 1-5. Bump 0.4.6 → 0.4.7. Commit+push.

---

## Phase 4b — Part 3 : Stand + HUB

### Task 8: Migrate Stand dashboard

**Files:**
- Modify: `src/app/ivy/stand/page.tsx`

**Context:** Festivals dashboard. Movement counts (today/week/month). Lighter page.

**Styling changes:**
- Eyebrow "Festivals · Runes de Chêne", Fraunces H1 "Tableau de bord" with italic accent
- Metric cards: cream-soft, Fraunces italic big numbers in moss, Inter uppercase eyebrow labels
- Any status badges → `<StatusBadge>`
- Remove orange/green accents

- [ ] Steps 1-5. Bump 0.4.7 → 0.4.8.

---

### Task 9: Migrate Stand zones

**Files:**
- Modify: `src/app/ivy/stand/zones/page.tsx`

**Context:** Study zones (festival date ranges) with stock movement stats. Bigger than the dashboard — includes tables of top products, top variants, date-range filters.

**Styling changes:**
- Full Atelier boréal treatment (zones are a featured workspace)
- Card-ify the zone list if it's a table
- Top products / top variants : mini tables with Fraunces italic quantities, cream-soft rows
- Date range filters → `<FilterChip>`
- Chart colors → Atelier palette

- [ ] Steps 1-5. Bump 0.4.8 → 0.4.9.

---

### Task 10: Migrate HUB de stand

**Files:**
- Modify: `src/app/ivy/hub/page.tsx`
- Modify: `src/app/ivy/hub/caisse.module.scss`
- Modify: `src/app/ivy/hub/components/SelectionZone.tsx`
- Modify: `src/app/ivy/hub/components/StockZone.tsx`
- Modify: `src/app/ivy/hub/layout.tsx`

**Context:** Fullscreen stock movement tracker. SelectionZone = left side (columns for product filtering), StockZone = right side (stock counters + validate button). No sidebar, no topnav (uses `layout.tsx` for fullscreen).

**Styling changes:**
- Background cream (not stark white)
- SelectionZone columns: cream-soft panels, divider borders, moss accents on active selections
- Column headers: Inter uppercase eyebrow + Fraunces italic if selected
- Product/variant rows: cream-warm hover, Fraunces italic for variant descriptors
- StockZone counters: Fraunces italic large numbers in moss for positive / sand for zero / rust for retours-pending
- "Valider les mouvements" button: slate primary large
- Mode retour toggle: `<FilterChip>` style
- Keep the fullscreen density — this is a festival tool, densité est prioritaire

Big task — comparable to stock order detail. Plan ~1h.

- [ ] Steps 1-5. Bump 0.4.9 → 0.4.10.

---

## Phase 4b — Part 4 : Periphery

### Task 11: Migrate Paramètres (batched, 5 sub-pages)

**Files:**
- Modify: `src/app/parametres/page.tsx` (hub)
- Modify: `src/app/parametres/prix/page.tsx`
- Modify: `src/app/parametres/couleurs/page.tsx`
- Modify: `src/app/parametres/metachamps/page.tsx`
- Modify: `src/app/parametres/descriptions/page.tsx`
- Modify: `src/app/parametres/illustrations/page.tsx`
- Modify: `src/layout/ParametresLayout.tsx` (shared layout)

**Context:** All 5 settings pages share `ParametresLayout`. Restyle the layout once, then each page gets a tokens pass.

**Styling changes:**
- ParametresLayout sidebar: cream-soft, moss accent for active nav (same pattern as IvyLayout)
- Each page: eyebrow "Paramètres · Runes de Chêne", Fraunces H1, cream-soft forms
- Forms: Mantine inputs with `data-*` overrides via CSS or `classNames` to get cream bg + moss focus
- Buttons: slate primary, ghost secondary
- Modals (used heavily in prix/couleurs/metachamps): cream-soft bg, Fraunces italic titles
- `<Badge>` / `<Chip>` → `<StatusBadge>` / `<TagPill>` / `<FilterChip>` where appropriate
- Drag handles (prix has drag-and-drop): keep functional, just restyle handle icon color

Since it's batched, take ~2-3h for the whole task. The ParametresLayout is done first, then each sub-page gets a tokens pass.

**Commit message:**
```
feat(design): migrate Paramètres (5 sub-pages + layout) to Atelier boréal
```

- [ ] Steps 1-5. Bump 0.4.10 → 0.4.11.

---

### Task 12: Migrate auth pages (batched: login, signup, onboarding, profil)

**Files:**
- Modify: `src/app/login/page.tsx` + `.module.scss`
- Modify: `src/app/signup/page.tsx`
- Modify: `src/app/onboarding/page.tsx`
- Modify: `src/app/ivy/profil/page.tsx`

**Context:** Public auth pages + profile. Each is a small form. These should be the most visible entry point to Ivy's brand — use `<IvyMark size="xl">` as hero.

**Styling changes:**
- Login / signup :
  - Full-page cream background
  - Centered card (cream-soft with shadow 0 8px 32px rgba(43,52,64,0.08), radius-xl)
  - `<IvyMark size="xl" />` at top, italic welcome text below in Fraunces italic
  - Inputs: cream bg, moss focus, divider border
  - Primary button: slate fill with cream text
  - Error messages: rust text color
- Onboarding :
  - Same shell as login
  - Multi-step form (if applicable) with moss progress
- Profil :
  - Page in the IvyLayout context
  - Avatar circle with slate border, Fraunces italic username
  - Sections (email, password, shops) as cream-soft cards
  - "Deconnexion" button: rust variant

- [ ] Steps 1-5. Bump 0.4.11 → 0.4.12.

---

## Phase 5 — Print pages

### Task 13: Migrate feuillet + impression (batched, stock orders)

**Files:**
- Modify: `src/app/ivy/commandes/stock/[orderId]/feuillet/page.tsx` + `.module.scss`
- Modify: `src/app/ivy/commandes/stock/[orderId]/impression/page.tsx` + `.module.scss`
- Possibly: `src/utils/print-content.ts` (generate the inline HTML for browser print)
- Possibly: `src/utils/print-helpers.ts`

**Context:** These are printed on paper. Feuillet = command sheet, Impression = production sheet (with illustrations). **Special print considerations** :
- Cream background prints faintly but visibly on paper — confirms it's an Atelier boréal document (nice)
- Fraunces italic titles look beautiful on paper
- But high contrast is needed for textile production (the worker must read easily under workshop lighting)
- No hover states (print is static)
- Page breaks must be respected (add `page-break-inside: avoid` on key blocks)

**Styling changes:**
- Both sheets: cream backgrounds + slate text (can switch to white background for max print contrast if user prefers — default to cream since it matches the app)
- Headers: Fraunces italic order number (`#1742`), customer name in bold slate, date in Fraunces italic
- Item rows: dashed divider, large Fraunces italic quantities, SKU in JetBrains Mono (technical reference), metafields prominently visible as `<MetaChip>` (THE whole point of print is to show production specs)
- Illustrations on impression sheet: full-width images with slate caption
- Totals / summary: Fraunces italic, moss for cost (if displayed — check if these sheets show cost or not; they probably should since it's the production context)
- Signature block at bottom if present

**Print-specific CSS:**
```scss
@media print {
  body { background: white; } // or keep cream — test both
  .card { page-break-inside: avoid; }
  a { color: inherit; text-decoration: none; }
  // Hide any interactive UI elements (buttons etc.) that shouldn't print
  .noPrint { display: none !important; }
}
```

- [ ] **Step 1:** Read both page files + print-content.ts + print-helpers.ts.
- [ ] **Step 2:** Apply Atelier boréal styling with print considerations.
- [ ] **Step 3:** Verify by clicking "Imprimer" in the app — preview the print dialog, check layout.
- [ ] **Step 4:** Build.
- [ ] **Step 5:** Bump 0.4.12 → 0.4.13, commit+push.

---

## Milestone

### Task 14: Retire Alegreya + bump to 0.5.0

**Files:**
- Modify: `src/app/layout.tsx` (remove Alegreya import + className)
- Modify: `src/config/version.ts`
- Grep-check: any file still using `$font-alegreya` or `var(--font-alegreya)` or `Alegreya` string — migrate to `$font-fraunces` or remove
- Grep-check: any file still using `color="orange"` / `color="green"` / `color="red"` — fix if found

**Context:** Final pass. Remove the Alegreya loader (it was kept for gradual migration). Verify no legacy references remain. Bump to `0.5.0 - Ivy (Atelier boréal complete)`.

- [ ] **Step 1:** Remove Alegreya from `src/app/layout.tsx`:
  - Remove `Alegreya` from the import line `import { Inter, Alegreya, Fraunces, JetBrains_Mono } from 'next/font/google';` → `import { Inter, Fraunces, JetBrains_Mono } from 'next/font/google';`
  - Remove the `const alegreya = Alegreya(...)` declaration
  - Remove `${alegreya.variable}` from the body className
- [ ] **Step 2:** Grep for `Alegreya` in `src/`:

```bash
# Use Grep tool: pattern = "Alegreya|--font-alegreya|\$font-alegreya"
```

  If any hits, migrate them to Fraunces or delete.

- [ ] **Step 3:** Grep for stale `color="orange|green|red|blue|yellow"` in `src/` (excluding `_archive/`). Fix any remaining.

```bash
# Use Grep tool: pattern = 'color="(orange|green|red|blue|yellow)"'
```

- [ ] **Step 4:** `pnpm build` must pass.
- [ ] **Step 5:** `pnpm dev` manual check: click through all major routes, confirm consistent look, no broken fonts.
- [ ] **Step 6:** Bump `src/config/version.ts` 0.4.13 → `'0.5.0 - Ivy (Atelier boréal complete)'`.
- [ ] **Step 7:** Commit + push:

```bash
git add src/app/layout.tsx src/config/version.ts
# Plus any other files modified during cleanup
git commit -m "$(cat <<'EOF'
chore: bump to 0.5.0 — Atelier boréal visual identity complete

Retire Alegreya font loader (Fraunces replaces all display usage).
Final grep pass confirms no stale orange/green/red color props
remain in live code paths. Every visible Ivy surface — app shell,
main pages, settings, auth, and print sheets — now follows the
Atelier boréal design system.

Milestone closes Phase 4b + Phase 5 of the design migration plan.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Self-review notes

**Spec coverage:**
- Phase 4b 10 pages: ✓ covered (Tasks 1-12, with some batching)
- Phase 5 print: ✓ Task 13
- Alegreya retirement: ✓ Task 14
- Milestone 0.5.0: ✓ Task 14

**Placeholder scan:** No TBDs. Each task has concrete files + styling directives + verification + commit. Bigger tasks (1, 6, 10) acknowledge the scale and direct the implementer to the hero page as reference rather than re-specifying full code.

**Type consistency:** All references to `<StatusBadge>`, `<TagPill>`, `<MetaChip>`, `<SkuChip>`, `<FilterChip>`, `<ProductThumbnail>`, `<CostDisplay>`, `<IvyMark>`, `<LastSyncTime>` are components already created in the foundation plan and confirmed to exist in `src/components/`.

**Scope:** Covers everything the spec deferred. Single cohesive migration initiative — all tasks share the same design system, just applied to different surfaces. No sub-specs needed.

**Risks flagged inline in tasks:** stock order detail preserves stream flow, facturation keeps sale prices (unlike boutique), HUB preserves fullscreen density, print pages balance app brand vs. print legibility.
