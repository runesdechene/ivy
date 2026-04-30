#!/usr/bin/env python3
"""Génère des nœuds Graphify pour les migrations SQL Supabase.

Wrapper externe : ne touche pas au module `graphify`. Lit
`supabase/migrations/*.sql`, parse les en-têtes commentés et les objets
définis (FUNCTION, TABLE, VIEW, TYPE, EXTENSION), puis merge le résultat
dans `graphify-out/graph.json`.

Conçu pour survivre aux rebuilds AST de `graphify.watch._rebuild_code` :
les nodes injectés ont `file_type="sql"`, donc préservés (cf watch.py L44).

Idempotent : à chaque run, supprime les nodes/edges SQL existants puis
re-génère depuis les fichiers actuels.

Usage :
    python3 scripts/graphify-sql.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"
GRAPH_PATH = REPO_ROOT / "graphify-out" / "graph.json"

CREATE_RE = re.compile(
    r"\bCREATE\s+(?:OR\s+REPLACE\s+)?"
    r"(FUNCTION|TABLE|VIEW|MATERIALIZED\s+VIEW|TYPE|EXTENSION|SCHEMA)\s+"
    r"(?:IF\s+NOT\s+EXISTS\s+)?"
    r'(?:"?public"?\s*\.\s*)?'
    r'"?([a-zA-Z_][a-zA-Z0-9_]*)"?',
    re.IGNORECASE,
)

# INSERT INTO volontairement exclu : on capture déjà les tables via FROM/JOIN
# et `SELECT ... INTO v_x` produit trop de faux-positifs sur les variables PL/pgSQL.
REF_RE = re.compile(
    r"\b(?:FROM|JOIN|UPDATE|REFERENCES|DELETE\s+FROM|INSERT\s+INTO)\s+"
    r"(?:ONLY\s+)?"
    r'(?:"?public"?\s*\.\s*)?'
    r'"?([a-zA-Z_][a-zA-Z0-9_]*)"?',
    re.IGNORECASE,
)

MIGRATION_REF_RE = re.compile(r"\b(\d{3})_[a-zA-Z0-9_-]+\.sql\b")

# Pattern .from('table') ou .from("table") avec litteral string only.
# On capture pas .from(varName) intentionnellement -- on s'arrete aux litteraux
# pour eviter les faux positifs et garder la regex simple.
TS_FROM_RE = re.compile(
    r"\.from\(\s*['\"]([a-zA-Z_]\w*)['\"]\s*\)",
)

# Globs scannes pour le code TS qui parle a Supabase.
# Specifique a Ivy (single Next.js avec src/ a la racine).
TS_GLOBS = ("src/**/*.ts", "src/**/*.tsx")

# Préfixes typiques des variables PL/pgSQL — à exclure des refs.
PLPGSQL_VAR_PREFIXES = ("v_", "p_", "tmp_", "_v_", "_p_")

SQL_NOISE_WORDS = {
    # mots-clés SQL
    "select", "where", "order", "group", "having", "limit", "offset",
    "and", "or", "not", "in", "between", "like", "is", "null", "true", "false",
    "distinct", "asc", "desc", "union", "all", "as", "on", "using",
    "lateral", "returning", "set", "values", "default", "check",
    "exists", "when", "then", "else", "end", "case", "with", "only",
    "stdin", "stdout", "binary", "csv",
    # mots qui apparaissent comme noms d'objet dans clauses FK / RLS
    "cascade", "restrict", "no", "action", "deferrable", "initially", "deferred",
    "immediate", "simple", "partial", "full", "none", "replication",
    "current_user", "session_user", "public", "database", "schema",
    "name", "to", "their", "update", "scratch", "data", "type",
    # builtins postgres fréquents
    "unnest", "generate_series", "regexp_split_to_table", "regexp_matches",
    "regexp_replace", "string_to_array", "array_agg", "array_to_string",
    "jsonb_array_elements", "jsonb_each", "jsonb_each_text", "jsonb_object_keys",
    "jsonb_build_object", "jsonb_build_array",
    "json_array_elements", "json_each", "json_each_text", "json_object_keys",
    "json_build_object", "json_build_array",
    "lower", "upper", "btrim", "trim", "coalesce", "nullif", "greatest", "least",
    "now", "count", "sum", "avg", "max", "min", "round", "abs", "length",
}


def slug(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", s).lower().strip("_")


def extract_header_comment(text: str) -> str:
    """Extrait le bloc `--` consécutif en tête de fichier (rationale)."""
    lines: list[str] = []
    for raw in text.splitlines():
        s = raw.strip()
        if s.startswith("--"):
            lines.append(s.lstrip("-").strip())
        elif s == "" and lines:
            lines.append("")
        elif s == "":
            continue
        else:
            break
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)


def parse_migration(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="ignore")
    rel_path = path.relative_to(REPO_ROOT).as_posix()
    file_id = f"migration_{slug(path.stem)}"
    header = extract_header_comment(text)

    nodes = [{
        "id": file_id,
        "label": path.stem,
        "file_type": "document",
        "category": "sql",
        "source_file": rel_path,
        "source_location": "L1",
        "description": header[:2000],
        "norm_label": path.stem.lower(),
    }]
    edges = []
    defined_ids: set[str] = set()

    for m in CREATE_RE.finditer(text):
        kind = re.sub(r"\s+", " ", m.group(1).upper())
        name = m.group(2)
        if not name or kind == "SCHEMA":
            continue
        line_no = text[: m.start()].count("\n") + 1
        obj_id = f"sql_{slug(name)}"
        if obj_id not in defined_ids:
            nodes.append({
                "id": obj_id,
                "label": name,
                "file_type": "document",
                "category": "sql",
                "source_file": rel_path,
                "source_location": f"L{line_no}",
                "kind": kind,
                "norm_label": name.lower(),
            })
            defined_ids.add(obj_id)
        edges.append({
            "source": file_id,
            "target": obj_id,
            "relation": "defines",
            "confidence": "EXTRACTED",
            "confidence_score": 1.0,
            "source_file": rel_path,
            "source_location": f"L{line_no}",
            "weight": 1.0,
        })

    refs: set[str] = set()
    for m in REF_RE.finditer(text):
        ref = m.group(1)
        low = ref.lower()
        if low in SQL_NOISE_WORDS:
            continue
        if low.startswith(PLPGSQL_VAR_PREFIXES):
            continue
        refs.add(ref)
    for ref in refs:
        ref_id = f"sql_{slug(ref)}"
        if ref_id in defined_ids:
            continue
        edges.append({
            "source": file_id,
            "target": ref_id,
            "relation": "uses",
            "confidence": "EXTRACTED",
            "confidence_score": 0.8,
            "source_file": rel_path,
            "weight": 1.0,
        })

    seen_follows: set[str] = set()
    for m in MIGRATION_REF_RE.finditer(text):
        target_num = m.group(1)
        for other in MIGRATIONS_DIR.glob(f"{target_num}_*.sql"):
            other_id = f"migration_{slug(other.stem)}"
            if other_id != file_id and other_id not in seen_follows:
                seen_follows.add(other_id)
                edges.append({
                    "source": file_id,
                    "target": other_id,
                    "relation": "follows",
                    "confidence": "EXTRACTED",
                    "confidence_score": 1.0,
                    "source_file": rel_path,
                    "weight": 1.0,
                })
            break

    return {"nodes": nodes, "edges": edges, "defined_ids": defined_ids}


def parse_ts_supabase(repo_root: Path, sql_table_ids: set[str]) -> list[dict]:
    """Scanne les fichiers TS/TSX et produit des edges 'references' file->table.

    - repo_root : racine du repo (utilisee pour calculer les chemins relatifs)
    - sql_table_ids : whitelist des ids SQL existants (ex: {"sql_products", ...}).
      Un match `.from('x')` ne cree d'edge que si `sql_<slug(x)>` est dans cet ensemble.

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


def main() -> int:
    if not GRAPH_PATH.exists():
        print(f"ERROR: {GRAPH_PATH} introuvable. Lance d'abord un rebuild Graphify.", file=sys.stderr)
        return 1
    if not MIGRATIONS_DIR.exists():
        print(f"ERROR: {MIGRATIONS_DIR} introuvable.", file=sys.stderr)
        return 1

    sql_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not sql_files:
        print("Aucune migration SQL trouvée. Rien à faire.")
        return 0

    print(f"Parsing {len(sql_files)} migration(s)...")
    all_nodes = []
    all_edges = []
    all_defined: set[str] = set()
    for sql_file in sql_files:
        r = parse_migration(sql_file)
        all_nodes.extend(r["nodes"])
        all_edges.extend(r["edges"])
        all_defined.update(r["defined_ids"])
        print(f"  {sql_file.name}: {len(r['nodes'])} nodes, {len(r['edges'])} edges")

    seen: set[str] = set()
    deduped: list[dict] = []
    for n in all_nodes:
        if n["id"] not in seen:
            seen.add(n["id"])
            deduped.append(n)

    referenced = {e["target"] for e in all_edges if e["relation"] == "uses"}
    missing = referenced - seen
    for ref_id in missing:
        name = ref_id[4:] if ref_id.startswith("sql_") else ref_id
        deduped.append({
            "id": ref_id,
            "label": name,
            "file_type": "document",
            "category": "sql",
            "source_file": "(externe ou non défini dans migrations)",
            "source_location": None,
            "kind": "REFERENCED",
            "norm_label": name.lower(),
        })
        seen.add(ref_id)

    print(f"\nMerging into {GRAPH_PATH.relative_to(REPO_ROOT).as_posix()}...")
    graph = json.loads(GRAPH_PATH.read_text(encoding="utf-8"))

    backup = GRAPH_PATH.with_suffix(".json.bak")
    backup.write_text(json.dumps(graph), encoding="utf-8")

    edges_key = "links" if "links" in graph else "edges"

    # Idempotence : on identifie nos nodes via category=="sql" (file_type="document"
    # est partagé avec d'autres docs hypothétiques, donc inutilisable seul).
    # Migration : capture aussi l'ancien tag file_type=="sql" pour nettoyer les
    # runs antérieurs avant l'introduction de category.
    existing_sql_ids = {
        n["id"] for n in graph.get("nodes", [])
        if n.get("category") == "sql" or n.get("file_type") == "sql"
    }
    if existing_sql_ids:
        print(f"  Suppression de {len(existing_sql_ids)} nodes SQL existants (re-gen idempotente)")
    graph["nodes"] = [
        n for n in graph["nodes"]
        if n.get("category") != "sql" and n.get("file_type") != "sql"
    ]
    graph[edges_key] = [
        e for e in graph.get(edges_key, [])
        if e.get("source") not in existing_sql_ids and e.get("target") not in existing_sql_ids
    ]

    graph["nodes"].extend(deduped)
    graph[edges_key].extend(all_edges)

    GRAPH_PATH.write_text(json.dumps(graph, indent=2), encoding="utf-8")

    sql_ids = {n["id"] for n in graph["nodes"] if n.get("category") == "sql"}
    sql_edge_count = sum(
        1 for e in graph[edges_key]
        if e.get("source") in sql_ids or e.get("target") in sql_ids
    )
    print(f"\nGraph à jour : {len(graph['nodes'])} nodes total ({len(sql_ids)} SQL), "
          f"{len(graph[edges_key])} edges total ({sql_edge_count} touchent du SQL)")
    print(f"Backup : {backup.relative_to(REPO_ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
