# OpenWolf

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.


# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Ivy

Ivy is a SaaS production management & stock tracking application for **Runes de Chêne**. It syncs orders from Shopify, tracks textile production with a checkbox system, handles supplier billing, manages inventory, and provides a stock movement tracker for festivals/events.

**Ivy is NOT a cash register (caisse).** The former POS system was removed in March 2026 to comply with NF525. Ivy does not record sales, prices, discounts, or payment data. The "HUB de stand" tracks stock movements only (quantities in/out, no prices).

Multi-tenant architecture: users belong to shops via `user_shops` (many-to-many), and all data is isolated by `shop_id` with RLS (`user_has_shop_access()`).

## Commands

```bash
pnpm dev          # Next.js dev server on port 3000
pnpm build        # Production build
pnpm start        # Run production server
pnpm lint         # Next.js linter
```

No test framework is configured.

## Tech Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** strict
- **Mantine 7** (UI) + **Tabler Icons** + **SASS modules** + PostCSS
- **Supabase** (PostgreSQL, Auth, Realtime) — primary backend
- **Shopify Admin API** (GraphQL via `@shopify/admin-api-client`, API version `2024-10`)
- **TanStack Query 5** for server state
- **Firebase** — legacy, auth migrated to Supabase, some references remain
- **pnpm** as package manager (never npm/yarn)
- **Deployed on Netlify** (manual CLI deploy, no auto-deploy)

## Architecture

```
src/
├── app/              # Next.js App Router — pages & API routes
├── actions/          # Server Actions (mutations)
├── api/              # REST API routes (sync, billing, inventory, stock, settings)
├── components/       # Reusable UI components
├── config/           # Constants & configuration (version.ts)
├── context/          # AuthContext, ShopContext, LocationContext
├── contexts/         # TerminalContext (floating logger)
├── firebase/         # Legacy Firebase config (being phased out)
├── graphql/          # Shopify GraphQL queries
├── hooks/            # Custom hooks (useOrders, usePriceRules, useMonthlyBalance, etc.)
├── layout/           # IvyLayout (sidebar), ParametresLayout
├── lib/              # Library functions
├── scenes/           # Complex page logic (business features)
├── shopify/          # Shopify client setup
├── state/            # TanStack Query provider
├── style/            # Global SCSS, fonts (Inter body, Alegreya headings)
├── supabase/         # Supabase client & service functions
├── types/            # TypeScript types
├── utils/            # Helpers (variant-helpers, color-transformer, size-helpers, etc.)
└── view-model/       # ViewModels / presenters
```

### Routing structure

- `/login`, `/signup` — public auth pages (Supabase Auth)
- `/onboarding` — new user flow
- `/ivy/commandes/boutique` — client orders (main working page, 2-column grid)
  - `/suivi` — order tracking, `/facturation` — billing (with monthly balance), `/archives` — fulfilled orders
- `/ivy/commandes/stock` — supplier/stock orders (with per-order balance, editable even when completed)
- `/ivy/caisse` — **HUB de stand** (stock movement tracker, own fullscreen layout)
- `/ivy/inventaire/produits` — product catalog, `/statistiques` — stats
- `/ivy/stand` — **Festivals** dashboard + zones d'étude (stock stats by period, quantities only)
- `/parametres/` — settings: prix, couleurs, metachamps

### Key API routes

- `POST /api/sync` — trigger Shopify order sync
- `GET /api/billing/monthly-status` — monthly billing report
- `GET /api/settings?shopId=` — shop settings (colors, rules)
- `GET /api/settings/price-rules/apply-stream` — apply price rules to Shopify variants (streaming)
- `GET /api/settings/price-rules/apply-local-stream` — apply to client orders (excludes batch)
- `GET /api/settings/price-rules/apply-stock-stream` — apply to supplier stock orders
- `GET /api/settings/price-rules/apply-ivy-stream` — apply to local variants
- `GET /api/settings/price-rules/apply-all-stream` — bulk apply all active rules
- `GET/POST/PUT/DELETE /api/settings/product-descriptions` — CRUD for description templates
- `GET /api/settings/product-descriptions/apply-stream` — chunked SSE apply of a description template to matching Shopify products
- `GET /api/settings/illustrations/sync-stream` — chunked SSE sync of product illustrations from Shopify metaobjects (`custom.illustration_produit`) into `products.illustration_url`
- `POST /api/inventory/sync` — inventory sync
- `POST /api/pos/stock/adjust` — adjust stock + log to `stock_movements` + sync Shopify
- `GET /api/pos/study-zones/stats` — stock movement stats for a date range (quantities only)

### Removed features (NF525 compliance, March 2026)

The following were **deleted** to ensure Ivy is not classified as a cash register:
- POS sales system (`pos_sales`, `pos_sale_items` tables still exist but are no longer written to)
- Discount engine (`discountEngine.ts`, `pos_discount_rules`)
- Sellers system (`pos_sellers`, `/parametres/vendeurs`)
- Payment modal, cart system, price display in stock tracker
- Sales history page (`/ivy/stand/historique`)
- External sales API (`/api/external/sales`)
- Discount rules settings page (`/parametres/remises`)

## HUB de stand (Stock Tracker)

The HUB de stand (`/ivy/caisse`) is a fullscreen stock movement tool for festivals:

- **SelectionZone** — columns for Type, Product, and each unique option name (Couleur, Taille, etc.)
  - Columns are dynamically created from Shopify product option names (not hardcoded option1/2/3)
  - Columns can be reordered via ‹ › arrows in headers (order persisted in localStorage)
  - Columns can be hidden/shown via checkboxes (hidden columns auto-show if a selected product needs them)
  - Cascade filtering works in any column order
- **StockZone** — aggregated counters per variant (no timestamps, no prices)
  - Mode retour toggle for stock returns (+1 instead of -1)
  - "Valider les mouvements" sends to `POST /api/pos/stock/adjust`

Stock movements are logged to `stock_movements` table (product, variant, quantity, date — no prices).

## Festivals (Stand Dashboard)

- `/ivy/stand` — dashboard with today/week/month movement counts
- `/ivy/stand/zones` — study zones (date ranges like "Festival Yggdrasil") with stats:
  - Articles sortis / retours
  - Top produits, top variantes (by quantity)
  - Options by category (Couleur, Taille — from Shopify option names)
  - Fragments (names grouped by prefix)
  - Movements by day

## Critical Business Logic

### Variant system

Variants support 2+ levels (Color / Size / Additional). Variant ID format:
```
orderId--sku--color--size--productIndex--quantityIndex
```
Key helpers in `src/utils/variant-helpers.ts`: `getColorFromVariant()`, `getSizeFromVariant()`, `generateVariantId()`, `getSelectedOptions()`.

### Color transformation

Shopify uses French color names, production uses English. Bidirectional mapping in `src/utils/color-transformer.ts` (e.g., "Chocolat" → "Mocha", "Bleu Marine" → "French Navy"). Dynamic mappings also loaded from Supabase.

### Price rules

Cost per item = `base_price` + sum of matching metafield modifiers + sum of matching option modifiers. Applied via streaming SSE endpoints. Four targets: Shopify variants, client orders, stock orders (supplier_orders), local variants.

**Important:** `supplier_order_items.metafields` stores display names as keys (e.g., `{"Recto": "DTG-CUI"}`), not namespace/key. The apply-stock-stream API resolves via `metafield_config` table.

### Billing / cost calculation

Cost per item = sum of all matching `price_rules`. Plus handling fee per order and monthly balance adjustment (`monthly_balance` table, editable per month in facturation page).

### Order filtering

- Client orders: tags does NOT contain "batch"
- Stock orders: stored in `supplier_orders` + `supplier_order_items` (separate tables, NOT in `orders`)
- Always excluded: tags "no-order-pro", "precommande", and order #1465
- Tips (no shipping + no SKU) are filtered out

## Database (Supabase)

Core tables: `shops`, `user_shops`, `orders`, `line_item_checks`, `order_progress`, `price_rules`, `price_rule_modifiers`, `price_rule_option_modifiers`, `billing_notes`, `monthly_balance`, `syncs`, `order_invoices`, `order_costs`, `supplier_orders`, `supplier_order_items`, `products`, `product_variants`, `inventory_levels`, `locations`, `stock_movements`, `metafield_config`, `product_descriptions`.

**Notable columns:**
- `products.illustration_url` — URL de l'illustration produit (source : métaobjet Shopify via `custom.illustration_produit`). Peuplée par `/api/settings/illustrations/sync-stream`. Affichée sur le feuillet de production.
- `product_descriptions` — modèles de descriptions HTML avec conditions de match (title/product_type contient X), appliquées en masse sur Shopify.

Legacy POS tables (still exist, no longer written to): `pos_sales`, `pos_sale_items`, `pos_sellers`, `pos_discount_rules`, `pos_study_zones`, `pos_stand_adjustment`.

All data tables have `shop_id` column enforced by RLS.

## Environment Variables

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Shopify
SHOPIFY_URL=
SHOPIFY_TOKEN=
SHOPIFY_PROVIDER_LOCATION_ID=
SHOPIFY_PROVIDER_REAL_LOCATION_ID=

# Firebase (legacy — still referenced)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

## Conventions

- **pnpm** only — never npm or yarn
- **TypeScript strict** — no `any`
- Path alias: `@/*` → `./src/*`
- Components: PascalCase files. Hooks: `use` prefix camelCase. Utils: kebab-case.
- SASS modules per feature (e.g., `boutique.module.scss`)
- Client components marked with `'use client'`
- Import order: React → Next.js → Libraries → Components → Utils → Types
- **Never record prices, sales amounts, or payment data** in the stock tracker (NF525)

## Existing documentation

- `_archive/MAIN.md` — legacy technical documentation from the Supabase migration (Feb 2026). Kept for historical reference; current state is reflected in this CLAUDE.md and the code.
