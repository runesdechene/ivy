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
- Lance `scripts/graphify-sql.py` si le commit touche `supabase/migrations/` (zone `graphify-sql-hook-start/end`)

**Rebuilds manuels** :
- TS / TSX : `python -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`
- SQL : `python scripts/graphify-sql.py`

Les pipelines AST et SQL sont indépendantes — les nodes SQL (`category: "sql"`) survivent au rebuild AST.

## Ecosystem

| Composant | Lieu | Rôle |
|-----------|------|------|
| **Vault Ivy** | `~/ivy-vault/` (symlink → `IVY - Obsidian/`, gitignored) | Domaine, décisions, gotchas, préférences — accédé en filesystem |
| **App Next.js** | `src/` | UI + API routes |
| **Supabase** | `supabase/migrations/` | DB + RLS multi-tenant |
| **Shopify Admin API** | externe (GraphQL) | Source produits / variantes / metafields |
| **Netlify** | déploiement manuel CLI | Hébergement front + functions |

Détail des zones dev : `~/ivy-vault/🛠️ DEV/_Index DEV.md`

## Conventions

- **pnpm** uniquement (jamais npm / yarn)
- **TypeScript strict** — pas de `any`
- **Path alias** : `@/*` → `./src/*`
- **Branche feature** obligatoire pour multi-commits (Ivy auto-deploy sur `push origin main` via Netlify)
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
