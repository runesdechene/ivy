// Génère les mockups d'un produit ou de tous les produits d'un motif, sans navigateur.
//   pnpm mockups "Loki | T-shirt unisexe"
//   pnpm mockups Loki
// Appelle les routes d'IVY (local par défaut, IVY_URL=https://ivy.runesdechene.com pour la prod) avec la clé
// d'automatisation MOCKUPS_CLE_AUTOMATE et la boutique MOCKUPS_SHOP_ID, lues dans .env.local.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const base = process.env.IVY_URL ?? 'http://localhost:3000';
const shopId = env.MOCKUPS_SHOP_ID;
const recherche = process.argv.slice(2).join(' ');
if (!recherche || !shopId || !env.MOCKUPS_CLE_AUTOMATE) {
  console.error('Usage : pnpm mockups "<titre du produit>" | <motif>   (MOCKUPS_SHOP_ID et MOCKUPS_CLE_AUTOMATE dans .env.local)');
  process.exit(1);
}

async function appel(chemin, corps) {
  const r = await fetch(`${base}${chemin}`, {
    method: corps ? 'POST' : 'GET',
    headers: { 'x-ivy-automate': env.MOCKUPS_CLE_AUTOMATE, 'Content-Type': 'application/json' },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
  return json;
}

const { produits } = await appel(`/api/mockups/produit?shopId=${shopId}&recherche=${encodeURIComponent(recherche)}`);
if (produits.length === 0) { console.error(`Aucun produit actif pour « ${recherche} »`); process.exit(1); }

let faits = 0, manques = 0;
for (const p of produits) {
  console.log(`\n${p.title}`);
  const { variantes } = await appel(`/api/mockups/produit?shopId=${shopId}&productId=${p.id}`);
  const couleurs = [...new Set(variantes.map((v) => v.couleur))];
  const faces = ['recto', 'verso'].filter((f) => variantes.some((v) => v[f]));
  for (const couleur of couleurs) for (const face of faces) {
    try {
      const r = await appel('/api/mockups/generer', { shopId, productId: p.id, couleur, face });
      if (r.image_url) { faits++; console.log(`  ✓ ${couleur} · ${face}  ${r.image_url}`); }
      else { manques++; console.log(`  ⚠ ${couleur} · ${face}  ${r.manque}`); }
    } catch (e) {
      manques++; console.log(`  ✗ ${couleur} · ${face}  ${e.message}`);
    }
  }
}
console.log(`\n${faits} mockup(s) enregistré(s), ${manques} à reprendre.`);
