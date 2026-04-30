# Graphify — edges code TS → tables SQL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Étendre `scripts/graphify-sql.py` (renommé `graphify-supabase.py`) pour scanner les `.from('table')` dans le code TS/TSX et générer des edges `references` reliant les fichiers code aux nodes SQL existants.

**Architecture:** Fonction pure `parse_ts_supabase(repo_root, sql_table_ids)` ajoutée au script existant. Détection par regex stricte `\.from\(['"]name['"]\)`. Disambiguation par whitelist : edge créé uniquement si le littéral correspond à un `sql_*` node existant. Granularité : un edge par couple (fichier, table) avec `weight = nombre d'occurrences`.

**Tech Stack:** Python 3.10 (stdlib only — re, json, pathlib, unittest, importlib), shell hook post-commit.

**Spec source:** `docs/superpowers/specs/2026-04-30-graphify-ts-to-sql-edges-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `scripts/graphify-sql.py` | Modify, then rename → `graphify-supabase.py` | Logique parsing SQL + parsing TS Supabase + merge graph |
| `scripts/test_graphify_sql.py` | Create, then rename → `test_graphify_supabase.py` | Tests unitaires des fonctions de parsing |
| `.git/hooks/post-commit` | Modify | Trigger élargi : déclenche aussi sur `src/**/*.{ts,tsx}`, invoque le script renommé |
| `CLAUDE.md` (racine) | Modify | MAJ référence script |

Le rename est atomique (Task 4) — on développe d'abord sur les noms actuels, puis renomme tout en un commit pour éviter de casser le hook intermédiairement.

---

## Task 1: Setup tests + smoke test du parsing SQL existant

**Objectif :** Avoir un fichier de tests runnable comme baseline. Vérifier qu'on n'a pas régressé après les modifs Task 2/3.

**Files:**
- Create: `scripts/test_graphify_sql.py` (sera renommé Task 4)

- [ ] **Step 1: Créer le fichier de tests avec smoke test du parser SQL**

```python
# scripts/test_graphify_sql.py
"""Tests pour scripts/graphify-sql.py (renommé graphify-supabase.py en Task 4).

Lance avec :
    python scripts/test_graphify_sql.py
"""
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "scripts" / "graphify-sql.py"


def load_script_module():
    """Charge le script (nom contient un tiret → importlib obligatoire)."""
    spec = importlib.util.spec_from_file_location("graphify_supabase", SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


mod = load_script_module()


class TestParseSqlMigration(unittest.TestCase):
    """Smoke tests : le parsing SQL existant continue de fonctionner."""

    def test_create_table_produces_node_and_defines_edge(self):
        with tempfile.TemporaryDirectory() as tmp:
            sql_path = Path(tmp) / "001_test.sql"
            sql_path.write_text(
                "-- Header rationale\nCREATE TABLE products (id int);\n",
                encoding="utf-8",
            )
            # parse_migration utilise REPO_ROOT pour calculer le chemin relatif.
            # On patche la constante du module pour ce test.
            original_root = mod.REPO_ROOT
            mod.REPO_ROOT = Path(tmp)
            try:
                result = mod.parse_migration(sql_path)
            finally:
                mod.REPO_ROOT = original_root

        node_ids = {n["id"] for n in result["nodes"]}
        self.assertIn("migration_001_test", node_ids)
        self.assertIn("sql_products", node_ids)

        defines_edges = [e for e in result["edges"] if e["relation"] == "defines"]
        self.assertEqual(len(defines_edges), 1)
        self.assertEqual(defines_edges[0]["source"], "migration_001_test")
        self.assertEqual(defines_edges[0]["target"], "sql_products")

    def test_from_clause_produces_uses_edge(self):
        with tempfile.TemporaryDirectory() as tmp:
            sql_path = Path(tmp) / "002_query.sql"
            sql_path.write_text(
                "CREATE VIEW v_summary AS SELECT * FROM products;\n",
                encoding="utf-8",
            )
            original_root = mod.REPO_ROOT
            mod.REPO_ROOT = Path(tmp)
            try:
                result = mod.parse_migration(sql_path)
            finally:
                mod.REPO_ROOT = original_root

        uses_edges = [e for e in result["edges"] if e["relation"] == "uses"]
        targets = {e["target"] for e in uses_edges}
        self.assertIn("sql_products", targets)


if __name__ == "__main__":
    unittest.main(verbosity=2)
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils passent**

Run:
```bash
python scripts/test_graphify_sql.py
```

Expected output (extrait) :
```
test_create_table_produces_node_and_defines_edge ... ok
test_from_clause_produces_uses_edge ... ok

----------------------------------------------------------------------
Ran 2 tests in 0.0XXs

OK
```

Si les tests échouent : ne pas continuer. Lire le message d'erreur, corriger le test (probablement un détail de chemin / API du script). Le but de ce step est seulement de vérifier qu'on a une baseline verte avant de toucher au comportement.

- [ ] **Step 3: Commit baseline**

```bash
git add scripts/test_graphify_sql.py
git commit -m "test(graphify): add baseline tests for SQL migration parser

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Ajouter `parse_ts_supabase()` (TDD)

**Objectif :** Fonction pure qui scanne des chemins TS/TSX, applique le pattern `.from('x')`, filtre par whitelist, déduplique, retourne une liste d'edges.

**Files:**
- Modify: `scripts/test_graphify_sql.py` (ajouter classe de tests)
- Modify: `scripts/graphify-sql.py` (ajouter fonction `parse_ts_supabase` + constantes)

### Step 1: Écrire les tests (failing)

- [ ] **Step 1: Ajouter les tests pour `parse_ts_supabase`**

Append à `scripts/test_graphify_sql.py` (juste avant le bloc `if __name__ == "__main__"`):

```python
class TestParseTsSupabase(unittest.TestCase):
    """Tests pour parse_ts_supabase : extraction des .from('table') du code TS."""

    def _run(self, files: dict[str, str], whitelist: set[str]):
        """files = {chemin_relatif: contenu}. Retourne (edges, missing)."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "src").mkdir()
            for rel, content in files.items():
                full = tmp_path / rel
                full.parent.mkdir(parents=True, exist_ok=True)
                full.write_text(content, encoding="utf-8")
            original_root = mod.REPO_ROOT
            mod.REPO_ROOT = tmp_path
            try:
                edges = mod.parse_ts_supabase(tmp_path, whitelist)
            finally:
                mod.REPO_ROOT = original_root
        return edges

    def test_simple_from_creates_edge_when_table_in_whitelist(self):
        edges = self._run(
            {"src/api.ts": "supabase.from('products').select('*')"},
            whitelist={"sql_products"},
        )
        self.assertEqual(len(edges), 1)
        e = edges[0]
        self.assertEqual(e["target"], "sql_products")
        self.assertEqual(e["relation"], "references")
        self.assertEqual(e["weight"], 1)
        self.assertEqual(e["source_file"], "src/api.ts")

    def test_from_with_unknown_table_is_skipped(self):
        edges = self._run(
            {"src/api.ts": "supabase.from('not_a_real_table').select()"},
            whitelist={"sql_products"},
        )
        self.assertEqual(edges, [])

    def test_buffer_from_utf8_is_skipped_via_whitelist(self):
        edges = self._run(
            {"src/api.ts": "Buffer.from('utf-8')"},
            whitelist={"sql_products"},
        )
        self.assertEqual(edges, [])

    def test_multiple_calls_same_table_dedup_with_weight(self):
        content = """
        supabase.from('products').select();
        supabase.from('products').insert({});
        supabase.from('products').update({});
        """
        edges = self._run(
            {"src/api.ts": content},
            whitelist={"sql_products"},
        )
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["weight"], 3)

    def test_multiple_files_each_get_their_edge(self):
        edges = self._run(
            {
                "src/a.ts": "supabase.from('products').select()",
                "src/b.ts": "supabase.from('products').select()",
            },
            whitelist={"sql_products"},
        )
        self.assertEqual(len(edges), 2)
        sources = {e["source_file"] for e in edges}
        self.assertEqual(sources, {"src/a.ts", "src/b.ts"})

    def test_tsx_files_are_scanned(self):
        edges = self._run(
            {"src/component.tsx": "supabase.from('products').select()"},
            whitelist={"sql_products"},
        )
        self.assertEqual(len(edges), 1)

    def test_from_with_variable_arg_is_not_matched(self):
        edges = self._run(
            {"src/api.ts": "supabase.from(tableName).select()"},
            whitelist={"sql_products"},
        )
        self.assertEqual(edges, [])

    def test_double_quoted_literal_is_matched(self):
        edges = self._run(
            {"src/api.ts": 'supabase.from("products").select()'},
            whitelist={"sql_products"},
        )
        self.assertEqual(len(edges), 1)

    def test_edge_source_id_is_slug_of_relative_path(self):
        edges = self._run(
            {"src/app/api/inventory/route.ts": "supabase.from('products').select()"},
            whitelist={"sql_products"},
        )
        self.assertEqual(len(edges), 1)
        # Le slug doit reproduire la convention graphify (séparateur _ pour /)
        self.assertEqual(edges[0]["source"], "src_app_api_inventory_route_ts")
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent tous**

Run:
```bash
python scripts/test_graphify_sql.py
```

Expected: les 9 tests `TestParseTsSupabase` échouent avec `AttributeError: module 'graphify_supabase' has no attribute 'parse_ts_supabase'`. Les 2 tests `TestParseSqlMigration` continuent de passer.

### Step 2: Implémenter `parse_ts_supabase`

- [ ] **Step 3: Ajouter les constantes et la fonction au script**

Modifier `scripts/graphify-sql.py` :

(a) Après la constante `MIGRATION_REF_RE` (autour de la ligne 48), ajouter :

```python
# Pattern .from('table') ou .from("table") avec littéral string only.
# On capture intentionnellement pas .from(varName) — on s'arrête aux littéraux
# pour éviter les faux positifs et garder la regex simple.
TS_FROM_RE = re.compile(
    r"\.from\(\s*['\"]([a-zA-Z_]\w*)['\"]\s*\)",
)

# Globs scannés pour le code TS qui parle à Supabase.
# Spécifique à Ivy (single Next.js avec src/ à la racine).
TS_GLOBS = ("src/**/*.ts", "src/**/*.tsx")
```

(b) Après la fonction `parse_migration` (autour de la ligne 190), avant `def main()`, ajouter :

```python
def parse_ts_supabase(repo_root: Path, sql_table_ids: set[str]) -> list[dict]:
    """Scanne les fichiers TS/TSX et produit des edges 'references' file→table.

    - repo_root : racine du repo (utilisée pour calculer les chemins relatifs)
    - sql_table_ids : whitelist des ids SQL existants (ex: {"sql_products", ...}).
      Un match `.from('x')` ne crée d'edge que si `sql_<slug(x)>` est dans cet ensemble.

    Retourne une liste d'edges (dicts au format graphify), un par couple (fichier, table)
    avec weight = nombre d'occurrences dans le fichier.
    """
    edges: list[dict] = []
    seen_files: set[Path] = set()

    for pattern in TS_GLOBS:
        for ts_path in sorted(repo_root.glob(pattern)):
            if ts_path in seen_files:
                continue
            seen_files.add(ts_path)

            try:
                text = ts_path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue

            counts: dict[str, int] = {}
            for m in TS_FROM_RE.finditer(text):
                table = m.group(1)
                target_id = f"sql_{slug(table)}"
                if target_id not in sql_table_ids:
                    continue
                counts[target_id] = counts.get(target_id, 0) + 1

            if not counts:
                continue

            rel_path = ts_path.relative_to(repo_root).as_posix()
            source_id = slug(rel_path.replace("/", "_"))
            for target_id, count in sorted(counts.items()):
                edges.append({
                    "source": source_id,
                    "target": target_id,
                    "relation": "references",
                    "confidence": "EXTRACTED",
                    "confidence_score": 1.0,
                    "source_file": rel_path,
                    "weight": float(count),
                })

    return edges
```

- [ ] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run:
```bash
python scripts/test_graphify_sql.py
```

Expected: tous les tests passent (2 SQL + 9 TS = 11 ok).

Si un test échoue : lire le message, corriger l'implémentation, re-lancer. Ne pas modifier les tests pour les faire passer.

- [ ] **Step 5: Commit**

```bash
git add scripts/graphify-sql.py scripts/test_graphify_sql.py
git commit -m "feat(graphify): add parse_ts_supabase for code->SQL edges

Detecte les .from('table') TS/TSX. Filtre par whitelist (tables
SQL existantes dans le graph). Edge par couple (fichier, table)
avec weight = nombre d'occurrences.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Intégrer `parse_ts_supabase` dans `main()`

**Objectif :** Appeler la nouvelle fonction depuis `main()` après le parsing SQL, injecter ses edges dans `graph.json`. Vérifier que l'idempotence fonctionne (les edges `references` sont nettoyés au prochain run car leur target est un node SQL).

**Files:**
- Modify: `scripts/graphify-sql.py` (`main()`)
- Modify: `scripts/test_graphify_sql.py` (ajouter test d'intégration)

- [ ] **Step 1: Ajouter un test d'intégration end-to-end**

Append à `scripts/test_graphify_sql.py` avant `if __name__ == "__main__"` :

```python
class TestMainIntegration(unittest.TestCase):
    """Run main() sur un mini-repo factice et vérifie le graph.json final."""

    def test_main_injects_references_edges_and_is_idempotent(self):
        import json
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            # Layout factice
            (tmp_path / "supabase" / "migrations").mkdir(parents=True)
            (tmp_path / "graphify-out").mkdir()
            (tmp_path / "src" / "app").mkdir(parents=True)

            # Une migration qui crée une table
            (tmp_path / "supabase" / "migrations" / "001_init.sql").write_text(
                "CREATE TABLE products (id int);\nCREATE TABLE orders (id int);\n",
                encoding="utf-8",
            )
            # Du code TS qui référence
            (tmp_path / "src" / "app" / "route.ts").write_text(
                """
                import { supabase } from '@/lib/db';
                supabase.from('products').select();
                supabase.from('products').insert({});
                supabase.from('orders').select();
                supabase.from('not_a_table').select(); // doit être ignoré
                Buffer.from('utf-8');
                """,
                encoding="utf-8",
            )
            # graph.json initial vide (mais valide)
            graph_path = tmp_path / "graphify-out" / "graph.json"
            graph_path.write_text(
                json.dumps({"directed": True, "nodes": [], "links": []}),
                encoding="utf-8",
            )

            # Patch des constantes pour pointer vers le tmp
            original_root = mod.REPO_ROOT
            original_migrations = mod.MIGRATIONS_DIR
            original_graph = mod.GRAPH_PATH
            mod.REPO_ROOT = tmp_path
            mod.MIGRATIONS_DIR = tmp_path / "supabase" / "migrations"
            mod.GRAPH_PATH = graph_path
            try:
                rc1 = mod.main()
                self.assertEqual(rc1, 0)
                graph1 = json.loads(graph_path.read_text(encoding="utf-8"))

                # Run idempotent
                rc2 = mod.main()
                self.assertEqual(rc2, 0)
                graph2 = json.loads(graph_path.read_text(encoding="utf-8"))
            finally:
                mod.REPO_ROOT = original_root
                mod.MIGRATIONS_DIR = original_migrations
                mod.GRAPH_PATH = original_graph

        # Vérifications graph1
        ref_edges = [l for l in graph1["links"] if l.get("relation") == "references"]
        self.assertEqual(len(ref_edges), 2, "1 edge per (file, table) couple")
        # products doit avoir weight=2 (2 occurrences), orders weight=1
        weights_by_target = {e["target"]: e["weight"] for e in ref_edges}
        self.assertEqual(weights_by_target["sql_products"], 2.0)
        self.assertEqual(weights_by_target["sql_orders"], 1.0)

        # Idempotence : exactement le même nombre d'edges
        ref_edges2 = [l for l in graph2["links"] if l.get("relation") == "references"]
        self.assertEqual(len(ref_edges2), 2)
        self.assertEqual(len(graph1["links"]), len(graph2["links"]))
        self.assertEqual(len(graph1["nodes"]), len(graph2["nodes"]))
```

- [ ] **Step 2: Lancer les tests, vérifier que le nouveau test échoue**

Run:
```bash
python scripts/test_graphify_sql.py
```

Expected: le test `test_main_injects_references_edges_and_is_idempotent` échoue (`len(ref_edges) == 0` au lieu de 2). Les autres tests passent.

- [ ] **Step 3: Modifier `main()` pour appeler `parse_ts_supabase`**

Dans `scripts/graphify-sql.py`, modifier `main()`. Trouver le bloc qui ajoute les nodes/edges au graph (vers la ligne 267) :

```python
    graph["nodes"].extend(deduped)
    graph[edges_key].extend(all_edges)

    GRAPH_PATH.write_text(json.dumps(graph, indent=2), encoding="utf-8")
```

Le remplacer par :

```python
    graph["nodes"].extend(deduped)
    graph[edges_key].extend(all_edges)

    # Edges code TS/TSX → tables SQL (whitelist par les ids déjà connus)
    sql_table_ids = {n["id"] for n in deduped if n.get("category") == "sql"}
    ts_edges = parse_ts_supabase(REPO_ROOT, sql_table_ids)
    if ts_edges:
        print(f"  TS→SQL : {len(ts_edges)} edges 'references' générés depuis src/")
        graph[edges_key].extend(ts_edges)

    GRAPH_PATH.write_text(json.dumps(graph, indent=2), encoding="utf-8")
```

- [ ] **Step 4: Vérifier l'idempotence côté code (pas de modif nécessaire)**

L'idempotence est déjà garantie par le bloc existant :

```python
graph[edges_key] = [
    e for e in graph.get(edges_key, [])
    if e.get("source") not in existing_sql_ids and e.get("target") not in existing_sql_ids
]
```

Cette purge supprime tout edge dont la source OU la target est un ancien node SQL. Les nouveaux edges `references` ont `target = sql_<table>` → ils seront purgés au run suivant et ré-injectés. Pas de modif nécessaire ici, mais le test d'intégration le valide.

- [ ] **Step 5: Lancer les tests, vérifier qu'ils passent tous**

Run:
```bash
python scripts/test_graphify_sql.py
```

Expected: 12 tests OK (2 SQL + 9 TS + 1 intégration).

- [ ] **Step 6: Commit**

```bash
git add scripts/graphify-sql.py scripts/test_graphify_sql.py
git commit -m "feat(graphify): wire parse_ts_supabase into main()

Apres le parsing des migrations, scanne les .ts/.tsx du repo et
injecte les edges 'references' fichier->table dans graph.json.
Idempotence preservee (edges purges via la regle existante sur
les nodes SQL).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Renommer le script + mettre à jour le hook + CLAUDE.md (atomique)

**Objectif :** `graphify-sql.py` → `graphify-supabase.py`, hook post-commit pointé vers le nouveau nom et trigger élargi aux fichiers `src/`. Le tout en un seul commit pour éviter de casser le pipeline.

**Files:**
- Rename: `scripts/graphify-sql.py` → `scripts/graphify-supabase.py`
- Rename: `scripts/test_graphify_sql.py` → `scripts/test_graphify_supabase.py`
- Modify: `scripts/test_graphify_supabase.py` (mettre à jour `SCRIPT_PATH`)
- Modify: `.git/hooks/post-commit` (zone `graphify-sql-hook-start/end`)
- Modify: `CLAUDE.md` (référence script)

- [ ] **Step 1: Renommer les deux fichiers**

```bash
git mv scripts/graphify-sql.py scripts/graphify-supabase.py
git mv scripts/test_graphify_sql.py scripts/test_graphify_supabase.py
```

- [ ] **Step 2: Mettre à jour la constante `SCRIPT_PATH` dans le fichier de tests**

Editer `scripts/test_graphify_supabase.py`. Remplacer :

```python
SCRIPT_PATH = REPO_ROOT / "scripts" / "graphify-sql.py"
```

par :

```python
SCRIPT_PATH = REPO_ROOT / "scripts" / "graphify-supabase.py"
```

- [ ] **Step 3: Mettre à jour le hook post-commit**

Editer `.git/hooks/post-commit`. Localiser la zone :

```sh
# graphify-sql-hook-start
# Custom: ingest SQL migrations into the graph if this commit touched supabase/migrations/
if echo "$CHANGED" | grep -q "supabase/migrations/" && [ -f "scripts/graphify-sql.py" ]; then
    if [ -n "$GRAPHIFY_PYTHON" ]; then
        "$GRAPHIFY_PYTHON" scripts/graphify-sql.py
    elif command -v python3 >/dev/null 2>&1; then
        python3 scripts/graphify-sql.py
    elif command -v python >/dev/null 2>&1; then
        python scripts/graphify-sql.py
    fi
fi
# graphify-sql-hook-end
```

La remplacer par :

```sh
# graphify-supabase-hook-start
# Custom: rebuild la couche Supabase du graphe (SQL + edges code->table)
# si ce commit a touché des migrations OU du code TS/TSX dans src/.
if echo "$CHANGED" | grep -qE "(supabase/migrations/|src/.+\.tsx?$)" && [ -f "scripts/graphify-supabase.py" ]; then
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

Note : les markers `graphify-sql-hook-*` sont remplacés par `graphify-supabase-hook-*` pour rester cohérents avec le nouveau nom.

- [ ] **Step 4: Mettre à jour `CLAUDE.md` projet**

Editer `CLAUDE.md` à la racine. Localiser :

```
- Lance `scripts/graphify-sql.py` si le commit touche `supabase/migrations/`
```

et :

```
- SQL : `python scripts/graphify-sql.py`
```

Remplacer les deux occurrences :

```
- Lance `scripts/graphify-supabase.py` si le commit touche `supabase/migrations/` ou `src/**/*.{ts,tsx}`
```

```
- SQL + TS→SQL : `python scripts/graphify-supabase.py`
```

Vérifier aussi la phrase qui décrit les pipelines : remplacer "AST et SQL sont indépendantes" par "AST et Supabase sont indépendantes" si présente, sinon laisser.

- [ ] **Step 5: Lancer les tests pour vérifier que tout fonctionne après rename**

Run:
```bash
python scripts/test_graphify_supabase.py
```

Expected: 12 tests OK.

Si erreur d'import : vérifier que `SCRIPT_PATH` pointe bien vers `graphify-supabase.py` (Step 2).

- [ ] **Step 6: Commit atomique**

```bash
git add scripts/graphify-supabase.py scripts/test_graphify_supabase.py CLAUDE.md
git add .git/hooks/post-commit 2>/dev/null || true  # le hook n'est pas tracké, mais on tente
git status --short
git commit -m "refactor(graphify): rename graphify-sql -> graphify-supabase

Le script ne se limite plus au SQL : il capture aussi les edges
code TS->tables SQL. Le post-commit hook trigger desormais aussi
sur src/**/*.{ts,tsx}.

Note: .git/hooks/post-commit n'est pas trackable mais a ete mis
a jour manuellement. Verifier sa coherence avec un nouveau clone.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Note : `.git/hooks/post-commit` est dans `.git/` donc non versionné. La modif est locale. Si le projet a un mécanisme d'install des hooks (script `setup-hooks.sh` ou similaire), le mettre à jour aussi — vérifier avec `ls scripts/ | grep -i hook` et `find . -name "*.hook*" -not -path "./node_modules/*" 2>/dev/null`.

---

## Task 5: Vérification end-to-end sur le repo réel

**Objectif :** Lancer le script sur le vrai `graph.json` d'Ivy, vérifier que ~150-300 edges `references` apparaissent, valider l'idempotence, exécuter une query de validation type "qui touche à `inventory_levels` ?".

- [ ] **Step 1: Backup du graph actuel**

```bash
cp graphify-out/graph.json graphify-out/graph.json.pre-supabase
```

- [ ] **Step 2: Premier run du script renommé**

```bash
python scripts/graphify-supabase.py
```

Expected (extraits) :
- Ligne `Parsing N migration(s)...`
- Ligne `TS→SQL : XXX edges 'references' générés depuis src/` avec XXX entre 100 et 400
- Ligne finale `Graph à jour : ... nodes total ...`

Si le compte d'edges est < 50 : suspect. Vérifier que le glob `src/**/*.ts` matche bien des fichiers (`python -c "from pathlib import Path; print(len(list(Path('.').glob('src/**/*.ts'))))"`).

- [ ] **Step 3: Vérification du contenu**

Run :
```bash
python -c "
import json
g = json.load(open('graphify-out/graph.json'))
links = g['links']
nodes = {n['id']: n for n in g['nodes']}
sql_ids = {nid for nid, n in nodes.items() if n.get('category')=='sql'}
ref_edges = [l for l in links if l.get('relation')=='references']
ts_to_sql = [l for l in ref_edges if l['_tgt'] in sql_ids and l['_src'] not in sql_ids]
print(f'Total references edges: {len(ref_edges)}')
print(f'TS->SQL references: {len(ts_to_sql)}')
print()
# Sample query : qui touche inventory_levels ?
target = 'sql_inventory_levels'
touchers = [nodes[l['_src']]['source_file'] for l in ts_to_sql if l['_tgt']==target]
print(f'Files touching inventory_levels ({len(touchers)}):')
for t in sorted(set(touchers))[:10]:
    print(f'  - {t}')
"
```

Expected:
- `Total references edges`: au moins 100
- `TS->SQL references`: identique ou très proche
- `Files touching inventory_levels`: liste non vide de chemins TS plausibles (probablement `src/app/api/inventory/...`)

- [ ] **Step 4: Test d'idempotence sur le repo réel**

Run :
```bash
python scripts/graphify-supabase.py
python -c "
import json
g = json.load(open('graphify-out/graph.json'))
ref = sum(1 for l in g['links'] if l.get('relation')=='references')
print(f'After 2nd run, references edges: {ref}')
"
```

Expected: `references edges` identique au Step 3 (idempotent).

- [ ] **Step 5: Test du trigger hook (TS uniquement)**

Toucher un fichier TS sans changer son comportement, commit, vérifier que le hook a déclenché le rebuild Supabase :

```bash
# Toucher un fichier TS de manière neutre (ajout puis retrait d'une ligne vide)
echo "" >> src/app/page.tsx
git add src/app/page.tsx
git commit -m "test: trigger graphify-supabase hook on TS commit"
# Vérifier dans la sortie que le hook a affiché 'TS→SQL : XX edges...'
```

Si la sortie ne contient pas la ligne `TS→SQL : ...`, le trigger ne fonctionne pas. Vérifier la regex dans le hook (Step 3 de Task 4) et l'option `grep -E`.

Optionnel : revert le commit de test si on ne veut pas le garder :
```bash
git reset --soft HEAD~1
git checkout src/app/page.tsx
```

- [ ] **Step 6: Cleanup backup et commit final si modif graph trackée**

```bash
rm graphify-out/graph.json.pre-supabase
git status --short
```

Si `graphify-out/graph.json` est tracké (vérifier avec `git ls-files graphify-out/graph.json`), le commit du Task 4 inclura déjà le nouveau graph via le hook post-commit. Sinon, si le rebuild post-Task 4 a généré un nouveau graph mais que `graphify-out/` est gitignored, rien à faire.

- [ ] **Step 7: Validation finale et résumé**

Afficher un résumé pour le user :

```bash
python -c "
import json
g = json.load(open('graphify-out/graph.json'))
links = g['links']
nodes = {n['id']: n for n in g['nodes']}
sql_ids = {nid for nid, n in nodes.items() if n.get('category')=='sql'}
ref_edges = [l for l in links if l.get('relation')=='references' and l.get('_tgt') in sql_ids]
print('=== Graph Supabase final ===')
print(f'Total nodes: {len(nodes)}')
print(f'SQL nodes: {len(sql_ids)}')
print(f'Total edges: {len(links)}')
print(f'TS->SQL references edges: {len(ref_edges)}')
# Top 5 tables les plus referencees
from collections import Counter
counts = Counter(l['_tgt'] for l in ref_edges)
print()
print('Top 5 tables most referenced from code:')
for tid, c in counts.most_common(5):
    print(f'  {nodes[tid][\"label\"]}: {c} files')
"
```

Cette sortie est à reporter au user pour validation que le système fonctionne comme attendu.

---

## Self-Review Checklist (effectué avant handoff)

**Spec coverage :**
- [x] Détection regex `.from('x')` → Task 2 Step 3 (TS_FROM_RE)
- [x] Whitelist par tables existantes → Task 2 Step 3 (filtre `if target_id not in sql_table_ids`)
- [x] Granularité 1 edge / (fichier, table) avec weight → Task 2 Step 3 (counts dict + weight)
- [x] Renommage script → Task 4 Step 1
- [x] Hook trigger élargi → Task 4 Step 3
- [x] Update CLAUDE.md → Task 4 Step 4
- [x] Idempotence vérifiée → Task 3 Step 1 (test_main_injects_references_edges_and_is_idempotent)
- [x] Vérification end-to-end → Task 5

**Placeholder scan :** Aucun TBD/TODO/"add appropriate" — tous les codes blocks sont complets.

**Type consistency :** `parse_ts_supabase(repo_root, sql_table_ids)` — même signature dans test (Task 2 Step 1) et impl (Task 2 Step 3) et appel main (Task 3 Step 3). Edge format identique partout (relation `references`, weight float, source_file relatif). `slug()` est une fonction existante du script (vérifié L78 du fichier original).

**Scope :** un seul plan focalisé. Pas de sous-projets indépendants.
