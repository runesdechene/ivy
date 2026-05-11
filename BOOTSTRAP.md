# Bootstrap Ivy sur une nouvelle machine

Guide pas-à-pas pour cloner et relancer le projet **Ivy** (Next.js 16 + Supabase + Shopify) avec **Graphify** activé.

> Repo : `https://github.com/runesdechene/ivy.git` — branche par défaut : `main`

---

## 1. Prérequis

| Outil | Version | Install |
|-------|---------|---------|
| **Git** | ≥ 2.40 | https://git-scm.com/download |
| **Node.js** | ≥ 20 (testé sur 22.12) | https://nodejs.org ou `nvm install 22` |
| **pnpm** | 9.14.2 (pinné via `packageManager`) | `corepack enable && corepack prepare pnpm@9.14.2 --activate` |
| **Python** | ≥ 3.10 | https://www.python.org/downloads (pour Graphify) |
| **pipx** | latest | `python -m pip install --user pipx && python -m pipx ensurepath` |
| **Netlify CLI** *(optionnel)* | latest | `pnpm add -g netlify-cli` (déploiement manuel) |

> **Windows :** le shell `bash` (Git Bash) est requis pour le hook post-commit. Il est livré avec Git for Windows.

---

## 2. Clone & install

```bash
git clone https://github.com/runesdechene/ivy.git
cd ivy
corepack enable                       # active pnpm 9.14.2 défini dans package.json
pnpm install                          # installe les deps Next/React/Mantine/Supabase
```

---

## 3. Variables d'environnement

```bash
cp .env.dist .env.local
```

Puis remplir `.env.local` avec les secrets (à récupérer depuis 1Password / dashboard) :

| Variable | Source |
|----------|--------|
| `SHOPIFY_URL` | Shopify Admin → Settings → Apps → custom app |
| `SHOPIFY_TOKEN` | idem, Admin API access token |
| `SHOPIFY_PROVIDER_LOCATION_ID` | Shopify Admin → Locations |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | Shopify Partner Dashboard → App OAuth |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | idem |
| `SUPABASE_SERVICE_ROLE_KEY` | idem (⚠️ secret server-only) |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` en dev |

---

## 4. Setup Graphify (knowledge graph + auto-rebuild)

### 4.1 Installer Graphify globalement
```bash
pipx install graphify
graphify --help                       # vérifier que la commande est dispo
```

### 4.2 Installer le hook post-commit
Le hook `.git/hooks/post-commit` **n'est pas tracké par git** (les hooks sont locaux par design). Il faut le créer manuellement.

Créer `.git/hooks/post-commit` avec ce contenu, puis `chmod +x .git/hooks/post-commit` :

```sh
#!/bin/sh
# graphify-hook-start
CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only HEAD 2>/dev/null)
[ -z "$CHANGED" ] && exit 0

GRAPHIFY_BIN=$(command -v graphify 2>/dev/null)
if [ -n "$GRAPHIFY_BIN" ]; then
    _SHEBANG=$(head -1 "$GRAPHIFY_BIN" | sed 's/^#![[:space:]]*//')
    case "$_SHEBANG" in
        */env\ *) GRAPHIFY_PYTHON="${_SHEBANG#*/env }" ;;
        *)        GRAPHIFY_PYTHON="$_SHEBANG" ;;
    esac
    case "$GRAPHIFY_PYTHON" in
        *[!a-zA-Z0-9/_.-]*) GRAPHIFY_PYTHON="" ;;
    esac
    if [ -n "$GRAPHIFY_PYTHON" ] && ! "$GRAPHIFY_PYTHON" -c "import graphify" 2>/dev/null; then
        GRAPHIFY_PYTHON=""
    fi
fi
if [ -z "$GRAPHIFY_PYTHON" ]; then
    if command -v python3 >/dev/null 2>&1 && python3 -c "import graphify" 2>/dev/null; then
        GRAPHIFY_PYTHON="python3"
    elif command -v python >/dev/null 2>&1 && python -c "import graphify" 2>/dev/null; then
        GRAPHIFY_PYTHON="python"
    else
        exit 0
    fi
fi

export GRAPHIFY_CHANGED="$CHANGED"
$GRAPHIFY_PYTHON -c "
import os, sys
from pathlib import Path
changed_raw = os.environ.get('GRAPHIFY_CHANGED', '')
changed = [Path(f.strip()) for f in changed_raw.strip().splitlines() if f.strip()]
if not changed:
    sys.exit(0)
print(f'[graphify hook] {len(changed)} file(s) changed - rebuilding graph...')
try:
    from graphify.watch import _rebuild_code
    _rebuild_code(Path('.'))
except Exception as exc:
    print(f'[graphify hook] Rebuild failed: {exc}')
    sys.exit(1)
"
# graphify-hook-end

# graphify-supabase-hook-start
if [ -f "scripts/graphify-supabase.py" ]; then
    if [ -n "$GRAPHIFY_PYTHON" ]; then
        "$GRAPHIFY_PYTHON" scripts/graphify-supabase.py
    elif command -v python3 >/dev/null 2>&1; then
        python3 scripts/graphify-supabase.py
    elif command -v python >/dev/null 2>&1; then
        python scripts/graphify-supabase.py
    fi
fi
# graphify-supabase-hook-end
```

### 4.3 Premier build du graphe
```bash
# Rebuild AST (TS/TSX)
python -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"

# Rebuild couche Supabase (SQL + edges code→table)
python scripts/graphify-supabase.py
```

Résultat dans `graphify-out/` (gitignored) :
- `graph.json` — graphe brut
- `GRAPH_REPORT.md` — résumé (god nodes, communautés)
- `wiki/index.md` — wiki navigable *(si activé)*

---

## 5. Vault Ivy (mémoire domaine — optionnel mais recommandé)

Le projet référence un vault Obsidian externe pour décisions / gotchas / préférences. Voir `CLAUDE.md` (section **Ecosystem** et **4-Layer Query Rule**).

Sur la nouvelle machine :
1. Récupérer le dossier `IVY - Obsidian/` (sync iCloud / Drive / clone séparé).
2. Créer une junction (Windows) ou un symlink (Mac/Linux) :
   ```powershell
   # Windows (PowerShell admin)
   New-Item -ItemType Junction -Path "$HOME\ivy-vault" -Target "C:\path\to\IVY - Obsidian"
   ```
   ```bash
   # Mac / Linux
   ln -s "/path/to/IVY - Obsidian" ~/ivy-vault
   ```

Sans ce vault, Claude Code fonctionne mais perd la couche **domaine/décisions** (couche 3 du 4-Layer Query Rule).

---

## 6. Vérifications

```bash
pnpm dev          # dev server sur http://localhost:3000
pnpm build        # production build (doit passer sans erreur TS)
pnpm lint         # Next.js linter
```

---

## 7. Workflow git (rappel du CLAUDE.md global de l'utilisateur)

Après tout changement de code :
1. Bumper `APP_VERSION` dans `version.ts` (patch)
2. `git add` + `git commit` (Conventional Commits)
3. `git push` (jamais directement sur `main` pour les multi-commits — Netlify auto-deploy sur `push origin main`)

---

## 8. État du repo au moment du bootstrap

- ✅ Working tree clean (aucun fichier non-tracké)
- ✅ Remote : `https://github.com/runesdechene/ivy.git`
- ✅ Tout le code, migrations Supabase, scripts Python, configs Next/TS/Netlify sont versionnés
- ❌ Non versionnés (à reconstruire) : `.env.local`, `.git/hooks/post-commit`, `graphify-out/`, `node_modules/`, `.next/`, `IVY - Obsidian/`, `.claude/`
