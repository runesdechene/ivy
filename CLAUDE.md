# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Ivy

Ivy is a SaaS production management & POS application for **Runes de Chêne**. It syncs orders from Shopify, tracks textile production with a checkbox system, handles supplier billing, manages inventory, and runs a point-of-sale (cash register).

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
- **Deployed on Netlify**

## Architecture

```
src/
├── app/              # Next.js App Router — pages & API routes
├── actions/          # Server Actions (mutations)
├── api/              # REST API routes (sync, billing, inventory, POS, settings)
├── components/       # Reusable UI components
├── config/           # Constants & configuration
├── context/          # AuthContext, ShopContext, LocationContext
├── contexts/         # TerminalContext (floating logger)
├── firebase/         # Legacy Firebase config (being phased out)
├── graphql/          # Shopify GraphQL queries
├── hooks/            # Custom hooks (useOrders, usePriceRules, useOrderCost, etc.)
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
- `/ivy/commandes/boutique` — client orders (main working page)
  - `/suivi` — order tracking, `/facturation` — billing, `/archives` — fulfilled orders
- `/ivy/commandes/stock` — batch/stock orders
- `/ivy/caisse` — POS (cash register), own layout
- `/ivy/inventaire/produits` — product catalog, `/statistiques` — stats
- `/ivy/stand` — booth management with zones & history
- `/parametres/` — settings: prix, couleurs, metachamps, remises, vendeurs

### Key API routes

- `POST /api/sync` — trigger Shopify order sync
- `GET /api/billing/monthly-status` — monthly billing report
- `GET /api/settings?shopId=` — shop settings (colors, rules)
- `POST /api/settings/price-rules/apply-stream` — streaming price calculation
- `POST /api/inventory/sync` — inventory sync
- `POST /api/pos/sales` — record POS sales

## Critical Business Logic

### Variant system

Variants support 2+ levels (Color / Size / Additional). Variant ID format:
```
orderId--sku--color--size--productIndex--quantityIndex
```
Key helpers in `src/utils/variant-helpers.ts`: `getColorFromVariant()`, `getSizeFromVariant()`, `generateVariantId()`, `getSelectedOptions()`.

### Color transformation

Shopify uses French color names, production uses English. Bidirectional mapping in `src/utils/color-transformer.ts` (e.g., "Chocolat" → "Mocha", "Bleu Marine" → "French Navy"). Dynamic mappings also loaded from Supabase.

### Billing / cost calculation

Cost per item = sum of all matching `price_rules` where `searchString` is found in the item description. Plus handling fee (4.5€ HT per order) and monthly balance adjustment.

### Order filtering

- Client orders: tags does NOT contain "batch"
- Stock orders: tags contains "batch"
- Always excluded: tags "no-order-pro", "precommande", and order #1465
- Tips (no shipping + no SKU) are filtered out

## Database (Supabase)

Core tables: `shops`, `user_shops`, `orders`, `line_item_checks`, `order_progress`, `price_rules`, `billing_notes`, `monthly_balance`, `syncs`, `order_invoices`, `order_costs`, `monthly_billing_notes`, `weekly_billing_notes`, `weekly_invoices`.

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

## Existing documentation

- `MAIN.md` — full technical documentation (database schemas, component catalog, workflows)
- `VARIANT_SYSTEM_UPDATE.md` — N-level variant system
- `CLEAN_OLD_VARIANTS.md` — old data cleanup
- `DEBUG_SYNC.md` — sync debugging
