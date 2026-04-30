# Graphify — edges code TS → tables SQL

**Date** : 2026-04-30
**Statut** : approuvé, prêt pour writing-plans

## Contexte et problème

Le graphe Graphify d'Ivy capture aujourd'hui :
- 681 nodes code (TS/TSX) via le rebuild AST
- 84 nodes SQL via `scripts/graphify-sql.py` (migrations + tables)
- 80 edges qui touchent du SQL (defines/uses/follows entre objets SQL)

**Trou critique** : zéro edge entre le code TS et les tables SQL. Le code Supabase qui fait `from('products')` n'est lié à aucun node `sql_products` dans le graphe. Question type *"quels endpoints touchent à `inventory_levels` ?"* est invisible à Graphify et nécessite un Grep + lectures multiples.

Sur Ivy : **372 occurrences de `.from('xxx')` dans 75 fichiers TS**, toutes Supabase (vérifié). C'est ~50% de la valeur potentielle de Graphify qu'on rate.

## Objectif

Ajouter automatiquement des edges `references` entre les fichiers TS/TSX et les nodes SQL existants, à chaque rebuild.

Comportement attendu : ~150-300 edges nouveaux dans `graph.json`, tous typés `references`, reliant un fichier code à un node `sql_<table>`. Question *"qui touche `inventory_levels` ?"* se résout en suivant les edges entrants du node.

## Design

### Détection — pattern et disambiguation

**Pattern regex** : `\.from\(\s*['"]([a-zA-Z_]\w*)['"]\s*\)`

Capture uniquement les littéraux de chaîne. Pas de capture de `.from(variableName)` (peu probable en pratique sur Ivy d'après le scan, à accepter comme limite).

**Disambiguation : whitelist par tables existantes**

Un match ne crée un edge **que si le littéral correspond à un node SQL déjà présent** (les 84 nodes générés par le parsing migrations). Conséquences :

- Zéro faux positif sur les `Buffer.from('utf-8')` ou `Array.from(...)` quotés
- Si un `.from('table_inexistante')` apparaît dans le code → pas d'edge (feature, pas bug : ça flagge une dérive entre code et migrations)
- Pas de RPC à gérer (0 occurrence sur Ivy)

### Granularité

**Un edge par couple (fichier, table)**, dédupliqué. Si un fichier touche `products` 5 fois, 1 seul edge avec `weight=5`. Pas de différenciation read/write pour cette V1 (le `.select`/`.insert` n'est pas trivial à chaîner depuis `.from()` en regex pure, et la question principale "qui touche cette table" est résolue par le simple fait qu'il y ait un edge).

### Lieu de la logique

**Étendre `scripts/graphify-sql.py`**, renommé en `scripts/graphify-supabase.py`. Le script gagne :

- Une fonction `parse_ts_supabase(repo_root, sql_table_ids)` qui scanne `src/**/*.{ts,tsx}` et retourne une liste d'edges
- Un appel à cette fonction dans `main()` après le parsing migrations, avec la whitelist construite depuis les nodes SQL générés
- Une extension de la règle d'idempotence : on supprime aussi les edges `references` qui ciblent un `sql_*` node avant ré-injection

Pas de changement à la lib `graphify` externe. Le script reste un wrapper en bordure.

### Chemins en dur

```python
TS_GLOBS = ["src/**/*.ts", "src/**/*.tsx"]
```

Constantes au top du module. Ivy est un single Next.js avec `src/` à la racine, ces patterns suffisent. Pas de config externe.

### Hook post-commit

Trigger actuel pour `graphify-sql.py` : déclenche uniquement si CHANGED contient `supabase/migrations/*.sql`.

Trigger nouveau pour `graphify-supabase.py` : déclenche aussi si CHANGED contient `src/**/*.ts` ou `src/**/*.tsx`. Sans ça, un nouveau `.from('inventory_levels')` ajouté dans le code n'apparaîtrait dans le graphe qu'au prochain commit migration.

Le script re-scan toujours TOUS les fichiers TS et SQL (full pass) pour garantir l'idempotence — pas de scan incrémental, pas de cache.

### Renommage

- `scripts/graphify-sql.py` → `scripts/graphify-supabase.py` (couvre désormais SQL + TS qui parle au SQL)
- `.git/hooks/post-commit` zone `graphify-sql-hook-start/end` : MAJ du nom de script invoqué + élargissement du trigger
- `CLAUDE.md` projet : MAJ de la référence au script

## Format des edges générés

```json
{
  "source": "src_app_api_inventory_sync_route_ts",
  "target": "sql_products",
  "relation": "references",
  "confidence": "EXTRACTED",
  "confidence_score": 1.0,
  "source_file": "src/app/api/inventory/sync/route.ts",
  "weight": 5
}
```

Le `_src` / `_tgt` sont remplis automatiquement par graphify lors du merge (ils existent déjà sur les edges actuels).

## Idempotence

À chaque run :

1. On supprime tous les nodes `category=="sql"` existants (logique actuelle, conservée)
2. On supprime tous les edges qui touchent un node SQL existant (logique actuelle, conservée — couvre déjà les edges `references` qu'on va injecter, puisque leur target est un `sql_*`)
3. On régénère depuis zéro

Aucune fuite possible d'un run à l'autre.

## Risques et limites assumés

- **`.from(variableName)` invisible** — non détecté par regex. Acceptable car peu pratiqué sur Ivy.
- **Tables référencées dans le code mais absentes des migrations** — pas d'edge. *Feature* (flagge la dérive), pas bug.
- **Renommage** — il faut s'assurer que le hook post-commit pointe vers le nouveau nom. Sinon le rebuild SQL casse en silence (le hook dit `exit 0` quand le script est introuvable). L'implémentation doit valider explicitement après commit que le hook fonctionne.
- **Coût d'exécution** — pure regex, ~1-2 sec sur 75 fichiers. Négligeable.

## Hors scope

- Différenciation `reads` / `writes` par opération
- Détection RLS policies → tables (rare en code TS)
- Détection RPC (`.rpc('fn')`) → SQL functions (0 occurrence sur Ivy aujourd'hui)
- Portage vers d'autres projets (chaque projet décidera indépendamment)
- Extraction de SQL brut depuis template literals (`sql\`SELECT * FROM x\``)

## Critères de succès

1. Après un run de `scripts/graphify-supabase.py`, `graph.json` contient ≥150 edges nouveaux de relation `references` ciblant des nodes `sql_*`
2. Une question *"qui touche à `inventory_levels` ?"* via query Python sur le graphe renvoie une liste non vide de fichiers TS
3. Re-run du script : nombre d'edges identique (idempotence vérifiée)
4. Commit qui touche un fichier TS uniquement : le hook déclenche bien le rebuild Supabase
5. Aucun edge généré pour des littéraux qui ne sont pas des tables connues (validé sur un cas test type `Buffer.from('utf-8')`)
