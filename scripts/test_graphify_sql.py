"""Tests pour scripts/graphify-sql.py (renomme graphify-supabase.py en Task 4).

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
