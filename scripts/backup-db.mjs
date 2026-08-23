/**
 * Sauvegarde locale des tables critiques d'Ivy, en JSON.
 *
 * Lecture seule côté base. Écrit dans `backups/<horodatage>/`.
 * À lancer AVANT toute opération qui écrit sur la base.
 *
 *   node scripts/backup-db.mjs
 *
 * Le dossier `backups/` est gitignoré : ces fichiers contiennent des données
 * commerciales, ils n'ont rien à faire dans le dépôt.
 */
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const env = {};
for (const line of fs.readFileSync(path.join(repoRoot, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const U = env.NEXT_PUBLIC_SUPABASE_URL;
const K = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}` };

/** Tables sauvegardées, par ordre d'importance. */
const TABLES = [
  'inventory_levels',
  'product_variants',
  'products',
  'locations',
  'stock_movements',
  'variant_metafields',
  'metafield_config',
  'price_rules',
  'price_rule_modifiers',
  'price_rule_option_modifiers',
  'shops',
];

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.join(repoRoot, 'backups', stamp);
fs.mkdirSync(dir, { recursive: true });

async function dump(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${table}?select=*&order=id`, {
      headers: { ...H, Range: `${from}-${from + 999}` },
    });
    if (!r.ok) {
      const body = await r.text();
      // On échoue bruyamment : une sauvegarde silencieusement partielle
      // est pire que pas de sauvegarde du tout.
      throw new Error(`${table} : HTTP ${r.status} — ${body.slice(0, 200)}`);
    }
    const chunk = await r.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    rows.push(...chunk);
    if (chunk.length < 1000) break;
  }
  fs.writeFileSync(path.join(dir, `${table}.json`), JSON.stringify(rows, null, 0), 'utf8');
  return rows.length;
}

const manifest = { created_at: new Date().toISOString(), tables: {} };
let total = 0;

for (const t of TABLES) {
  try {
    const n = await dump(t);
    manifest.tables[t] = n;
    total += n;
    console.log(`  ${String(n).padStart(7)} lignes  ${t}`);
  } catch (e) {
    manifest.tables[t] = `ERREUR: ${e.message}`;
    console.log(`  ÉCHEC            ${t} — ${e.message}`);
  }
}

fs.writeFileSync(path.join(dir, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log(`\n${total} lignes sauvegardées dans backups/${stamp}/`);
