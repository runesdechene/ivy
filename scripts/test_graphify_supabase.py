"""Tests pour scripts/graphify-supabase.py.

Lance avec :
    python scripts/test_graphify_supabase.py
"""
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "scripts" / "graphify-supabase.py"


def load_script_module():
    """Charge le script (nom contient un tiret -> importlib obligatoire)."""
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


class TestParseTsSupabase(unittest.TestCase):
    """Tests pour parse_ts_supabase : extraction des .from('table') du code TS."""

    def _run(self, files: dict, whitelist: set):
        """files = {chemin_relatif: contenu}. Retourne edges."""
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
        self.assertEqual(edges[0]["source"], "src_app_api_inventory_route_ts")


class TestMainIntegration(unittest.TestCase):
    """Run main() sur un mini-repo factice et verifie le graph.json final."""

    def test_main_injects_references_edges_and_is_idempotent(self):
        import json
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "supabase" / "migrations").mkdir(parents=True)
            (tmp_path / "graphify-out").mkdir()
            (tmp_path / "src" / "app").mkdir(parents=True)

            (tmp_path / "supabase" / "migrations" / "001_init.sql").write_text(
                "CREATE TABLE products (id int);\nCREATE TABLE orders (id int);\n",
                encoding="utf-8",
            )
            (tmp_path / "src" / "app" / "route.ts").write_text(
                """
                import { supabase } from '@/lib/db';
                supabase.from('products').select();
                supabase.from('products').insert({});
                supabase.from('orders').select();
                supabase.from('not_a_table').select();
                Buffer.from('utf-8');
                """,
                encoding="utf-8",
            )
            graph_path = tmp_path / "graphify-out" / "graph.json"
            graph_path.write_text(
                json.dumps({"directed": True, "nodes": [], "links": []}),
                encoding="utf-8",
            )

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

                rc2 = mod.main()
                self.assertEqual(rc2, 0)
                graph2 = json.loads(graph_path.read_text(encoding="utf-8"))
            finally:
                mod.REPO_ROOT = original_root
                mod.MIGRATIONS_DIR = original_migrations
                mod.GRAPH_PATH = original_graph

        ref_edges = [l for l in graph1["links"] if l.get("relation") == "references"]
        self.assertEqual(len(ref_edges), 2, "1 edge per (file, table) couple")
        weights_by_target = {e["target"]: e["weight"] for e in ref_edges}
        self.assertEqual(weights_by_target["sql_products"], 2.0)
        self.assertEqual(weights_by_target["sql_orders"], 1.0)

        ref_edges2 = [l for l in graph2["links"] if l.get("relation") == "references"]
        self.assertEqual(len(ref_edges2), 2)
        self.assertEqual(len(graph1["links"]), len(graph2["links"]))
        self.assertEqual(len(graph1["nodes"]), len(graph2["nodes"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
