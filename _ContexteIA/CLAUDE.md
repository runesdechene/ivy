# Ivy — Production & Stock SaaS

> Next.js 16 · React 19 · TypeScript strict · Mantine 7 · Supabase · Shopify Admin API · pnpm · Netlify
> Mémoire unifiée : **vault Ivy** (filesystem) + **Graphify** (TS + SQL) + **Context7**

> Identité, routing par intent et règle d'or : voir `~/ivy-vault/CLAUDE.md` (auto-chargé via le mécanisme natif Claude Code des CLAUDE.md hiérarchiques).

## 4-Layer Query Rule

Avant de lire un fichier brut, interroger dans cet ordre :

1. **Lib externe** (Next.js, React, Mantine, Supabase, Shopify Admin API, TanStack Query, Tabler Icons…) → **Context7 MCP**
2. **Structure / relation code local** → **Graphify** (`graphify-out/graph.json` + `GRAPH_REPORT.md`)
3. **Domaine / décision / gotcha / préférence** → **Filesystem direct** sur `~/ivy-vault/` (Read par chemin, Glob pour lister, Grep pour terme exact). Le routing par intent du `~/ivy-vault/CLAUDE.md` canalise les lectures.
4. **Édition de code ou fallback** → **Read** du fichier brut (Grep pour lookup atomique)

## Graphify

- Avant toute question architecture / codebase : lire `graphify-out/GRAPH_REPORT.md` (god nodes, communautés)
- Si `graphify-out/wiki/index.md` existe : naviguer via le wiki

**Auto via post-commit hook** (`.git/hooks/post-commit`) :
- Rebuild AST sur tout commit (zone `graphify-hook-start/end`)
- Lance `scripts/graphify-supabase.py` à chaque commit (zone `graphify-supabase-hook-start/end`). Inconditionnel car l'AST rebuild wipe les edges `references` file→table — il faut les ré-injecter à chaque fois.

**Rebuilds manuels** :
- TS / TSX : `python -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`
- SQL + edges code→SQL : `python scripts/graphify-supabase.py`

Les pipelines AST et Supabase sont indépendantes — les nodes SQL (`category: "sql"`) survivent au rebuild AST. Le script Supabase couvre à la fois le parsing des migrations et les edges `references` reliant chaque fichier TS/TSX aux tables qu'il interroge via `.from('table')`.

## Ecosystem

| Composant | Lieu | Rôle |
|-----------|------|------|
| **Vault Ivy** | `~/ivy-vault/` (symlink → `IVY - Obsidian/`, gitignored) | Domaine, décisions, gotchas, préférences — accédé en filesystem |
| **App Next.js** | `src/` | UI + API routes |
| **Supabase** | `supabase/migrations/` | DB + RLS multi-tenant |
| **Shopify Admin API** | externe (GraphQL) | Source produits / variantes / metafields |
| **Netlify** | projet `ivy-app` → `ivy.runesdechene.com` | Hébergement front + functions. **Auto-deploy sur `push origin main`** — `main` est la SEULE branche buildée |

Détail des zones dev : `~/ivy-vault/🛠️ DEV/_Index DEV.md`

## Conventions

- **pnpm** uniquement (jamais npm / yarn)
- **TypeScript strict** — pas de `any`
- **Path alias** : `@/*` → `./src/*`
- **Branche feature** obligatoire pour multi-commits (Ivy auto-deploy sur `push origin main` via Netlify). Une branche feature poussée ne déploie **rien** (`allowed_branches: [main]`) — pour tester en ligne sans toucher la prod : `npx netlify deploy` (draft, sans `--prod`)
- **`APP_VERSION`** (`src/config/version.ts`) : patch +1 à chaque commit touchant `src/`. `package.json` (`0.1.0`, `order-pro`) est mort, ne pas s'y fier
- **NF525** : Ivy n'est PAS une caisse — jamais enregistrer prix de vente / paiements / remises dans le tracker de stock
- **Multi-tenant** : tout query DB doit filtrer par `shop_id` (RLS bypassée par `service_role` côté API)

Détail des conventions non triviales : `~/ivy-vault/🛠️ DEV/Conventions/`

## Commandes

```bash
pnpm dev          # dev server port 3000
pnpm build        # production build
pnpm lint         # Next.js linter
```

Pas de framework de tests configuré. Vérification manuelle via dev server.
