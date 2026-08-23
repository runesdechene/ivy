/**
 * Déclaration douanière suisse — génération du document à imprimer.
 *
 * LECTURE SEULE. N'écrit RIEN dans Ivy ni chez Shopify. Produit un fichier HTML
 * à ouvrir dans un navigateur puis à imprimer en PDF (Ctrl+P).
 *
 *   node scripts/douane-suisse.mjs --rate=0.94 --gross=180 [--location=Boxer] [--ref=1187-xxx]
 *
 * --rate   taux EUR -> CHF du jour (obligatoire)
 * --gross  poids brut total en kg, caisses pesées (optionnel mais attendu par la douane)
 *
 * Structure produite : une feuille de résumé, puis une feuille par produit.
 * Les variantes à quantité 0 ne sont pas imprimées.
 *
 * Décomposition du coût, reprise à l'identique de la logique de
 * `/api/settings/price-rules/apply-ivy-stream` :
 *   textile    = price_rules.base_price + modificateurs d'OPTION
 *   impression = modificateurs de MÉTACHAMP
 *   total      = textile + impression, comparé à product_variants.cost.
 * Un écart n'est jamais corrigé en silence : la ligne est marquée sur le document.
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = n => {
  const a = process.argv.find(x => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : null;
};

const RATE = Number(arg('rate'));
const GROSS = arg('gross') ? Number(arg('gross')) : null;
const LOC = arg('location') || 'Boxer';
const REF = arg('ref') || '';
const ORIGIN = arg('origin') || 'BD';

if (!RATE || RATE <= 0) {
  console.error('ERREUR : --rate=<taux EUR vers CHF> est obligatoire. Ex. --rate=0.94');
  process.exit(1);
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const env = {};
for (const line of fs.readFileSync(path.join(repoRoot, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const U = env.NEXT_PUBLIC_SUPABASE_URL;
const K = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}` };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readAll(query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${query}`, { headers: { ...H, Range: `${from}-${from + 999}` } });
    if (!r.ok) throw new Error(`Supabase ${r.status} sur ${query}`);
    const chunk = await r.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    out.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return out;
}

console.log('Lecture des données...');

const [shop] = await (await fetch(`${U}/rest/v1/shops?select=id,shopify_url,shopify_token&limit=1`, { headers: H })).json();
const locations = await readAll(`locations?select=id,name,shopify_id&shop_id=eq.${shop.id}&order=name`);
const location = locations.find(l => l.name.toLowerCase().includes(LOC.toLowerCase()));
if (!location) {
  console.error(`ERREUR : aucun emplacement ne correspond à "${LOC}". Disponibles : ${locations.map(l => l.name).join(', ')}`);
  process.exit(1);
}

const levels = await readAll(`inventory_levels?select=variant_id,quantity&location_id=eq.${location.shopify_id}&quantity=gt.0&order=variant_id`);
const variants = await readAll('product_variants?select=id,product_id,shopify_id,title,sku,option1,option2,option3,cost,price,inventory_item_id,shopify_active&order=id');
const products = await readAll(`products?select=id,title,product_type,image_url,option1_name,option2_name,option3_name&shop_id=eq.${shop.id}&order=id`);
const rules = await readAll(`price_rules?select=id,sku,base_price,product_type,is_active&shop_id=eq.${shop.id}&order=id`);
const mods = await readAll('price_rule_modifiers?select=price_rule_id,metafield_namespace,metafield_key,metafield_value,modifier_amount&order=id');
const optMods = await readAll('price_rule_option_modifiers?select=price_rule_id,option_name,option_value,modifier_amount&order=id');

const V = new Map(variants.map(v => [v.id, v]));
const P = new Map(products.map(p => [p.id, p]));

// Métachamps des seules variantes concernées
const variantIds = levels.map(l => l.variant_id);
const metaByVariant = new Map();
for (let i = 0; i < variantIds.length; i += 200) {
  const batch = variantIds.slice(i, i + 200);
  const r = await fetch(`${U}/rest/v1/variant_metafields?select=variant_id,namespace,key,value&variant_id=in.(${batch.join(',')})`, { headers: H });
  if (!r.ok) throw new Error(`variant_metafields : HTTP ${r.status}`);
  for (const mf of await r.json()) {
    if (!metaByVariant.has(mf.variant_id)) metaByVariant.set(mf.variant_id, []);
    metaByVariant.get(mf.variant_id).push(mf);
  }
}

// Poids : lus chez Shopify (grams par variante)
console.log('Lecture des poids chez Shopify...');
const gramsByShopifyVariant = new Map();
{
  let url = `https://${shop.shopify_url}/admin/api/2024-01/products.json?limit=250`;
  while (url) {
    const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': shop.shopify_token } });
    if (r.status === 429) { await sleep(2500); continue; }
    if (!r.ok) throw new Error(`Shopify ${r.status} sur products.json`);
    const b = await r.json();
    for (const p of b.products || []) {
      for (const v of p.variants || []) gramsByShopifyVariant.set(String(v.id), v.grams ?? 0);
    }
    const link = r.headers.get('link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
    await sleep(500);
  }
}

const modsByRule = new Map();
for (const m of mods) {
  if (!modsByRule.has(m.price_rule_id)) modsByRule.set(m.price_rule_id, []);
  modsByRule.get(m.price_rule_id).push(m);
}
const optModsByRule = new Map();
for (const m of optMods) {
  if (!optModsByRule.has(m.price_rule_id)) optModsByRule.set(m.price_rule_id, []);
  optModsByRule.get(m.price_rule_id).push(m);
}

/** Reproduit exactement le calcul d'apply-ivy-stream, mais en séparant textile et impression. */
function breakdown(variant, product) {
  const sku = (variant.sku || '').toUpperCase();
  const rule = rules.find(r =>
    r.is_active !== false &&
    sku.startsWith((r.sku || '').toUpperCase()) &&
    (!r.product_type || r.product_type === product.product_type)
  );
  if (!rule) return { textile: null, print: null, total: null, rule: null, mismatch: false };

  let textile = Number(rule.base_price) || 0;
  let print = 0;

  const metafields = metaByVariant.get(variant.id) || [];
  for (const mod of modsByRule.get(rule.id) || []) {
    const hit = metafields.find(mf =>
      mf.namespace === mod.metafield_namespace &&
      mf.key === mod.metafield_key &&
      mf.value === mod.metafield_value
    );
    if (hit) print += Number(mod.modifier_amount) || 0;
  }

  const names = {
    option1: product.option1_name || 'Option 1',
    option2: product.option2_name || 'Option 2',
    option3: product.option3_name || 'Option 3',
  };
  const selected = [];
  if (variant.option1) selected.push({ name: names.option1, value: variant.option1 });
  if (variant.option2) selected.push({ name: names.option2, value: variant.option2 });
  if (variant.option3) selected.push({ name: names.option3, value: variant.option3 });

  for (const om of optModsByRule.get(rule.id) || []) {
    const hit = selected.find(o =>
      o.name.toLowerCase() === (om.option_name || '').toLowerCase() &&
      o.value.toLowerCase() === (om.option_value || '').toLowerCase()
    );
    if (hit) textile += Number(om.modifier_amount) || 0;
  }

  const total = Math.round((textile + print) * 100) / 100;
  const recorded = Number(variant.cost) || 0;
  return { textile, print, total, rule: rule.sku, mismatch: Math.abs(total - recorded) >= 0.005, recorded };
}

const SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'];
const sizeRank = s => {
  const i = SIZES.indexOf((s || '').trim().toUpperCase());
  return i === -1 ? 999 : i;
};

function optionOf(variant, product, wanted) {
  const pairs = [
    [product.option1_name, variant.option1],
    [product.option2_name, variant.option2],
    [product.option3_name, variant.option3],
  ];
  for (const [name, value] of pairs) {
    if (!name || !value) continue;
    const n = name.trim().toLowerCase();
    if (wanted === 'size' && (n === 'taille' || n === 'size')) return value;
    if (wanted === 'color' && (n === 'couleur' || n === 'color' || n === 'coloris')) return value;
  }
  return '';
}

// Construction des lignes
const byProduct = new Map();
const problems = { noWeight: [], noRule: [], mismatch: [], noPrice: [] };
let totalPieces = 0, totalNetG = 0, totalCustomsEur = 0, totalValueEur = 0;
const byType = new Map();

for (const lvl of levels) {
  const v = V.get(lvl.variant_id);
  if (!v) continue;
  const p = P.get(v.product_id);
  if (!p) continue;

  const grams = gramsByShopifyVariant.get(String(v.shopify_id ?? '')) ?? null;
  const b = breakdown(v, p);
  const price = Number(v.price) || 0;
  const qty = lvl.quantity;

  const label = `${p.title} — ${v.title}`;
  if (!grams) problems.noWeight.push(label);
  if (!b.rule) problems.noRule.push(label);
  else if (b.mismatch) problems.mismatch.push(`${label} (calculé ${b.total} € / enregistré ${b.recorded} €)`);
  if (!price) problems.noPrice.push(label);

  const row = {
    type: p.product_type || '(sans type)',
    image: p.image_url,
    ref: p.title,
    size: optionOf(v, p, 'size') || v.option2 || '',
    color: optionOf(v, p, 'color') || v.option1 || '',
    qty,
    grams,
    textile: b.textile,
    print: b.print,
    total: b.total,
    price,
    incomplete: !grams || !b.rule || b.mismatch || !price,
  };

  if (!byProduct.has(p.id)) byProduct.set(p.id, { product: p, rows: [] });
  byProduct.get(p.id).rows.push(row);

  totalPieces += qty;
  totalNetG += (grams || 0) * qty;
  totalCustomsEur += price * qty;
  totalValueEur += (b.total || 0) * qty;

  const t = byType.get(row.type) || { qty: 0, netG: 0, customsEur: 0, valueEur: 0 };
  t.qty += qty;
  t.netG += (grams || 0) * qty;
  t.customsEur += price * qty;
  t.valueEur += (b.total || 0) * qty;
  byType.set(row.type, t);
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const eur = n => (Math.round(n * 100) / 100).toFixed(2);
const chf = n => (Math.round(n * RATE * 100) / 100).toFixed(2);
const kg = g => (g / 1000).toFixed(3);

const today = new Date().toISOString().slice(0, 10);
const netKg = totalNetG / 1000;

const sheets = [...byProduct.values()].sort((a, b) =>
  (a.product.product_type || '').localeCompare(b.product.product_type || '') ||
  a.product.title.localeCompare(b.product.title)
);

let html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Declaration douaniere suisse — ${esc(location.name)} — ${today}</title>
<style>
 @page { size: A4 landscape; margin: 10mm; }
 body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 9pt; color: #1a1a1a; }
 h1 { font-size: 15pt; margin: 0 0 2mm; }
 h2 { font-size: 12pt; margin: 0 0 1mm; }
 .sheet { page-break-after: always; }
 .sheet:last-child { page-break-after: auto; }
 .meta { margin-bottom: 4mm; font-size: 9pt; }
 .meta b { display: inline-block; min-width: 42mm; }
 table { border-collapse: collapse; width: 100%; }
 th, td { border: 1px solid #999; padding: 1.2mm 1.6mm; text-align: right; }
 th { background: #eee; text-align: center; font-size: 8pt; }
 td.l, th.l { text-align: left; }
 tr.incomplete td { background: #ffecec; }
 tfoot td { font-weight: bold; background: #f4f4f4; }
 img { height: 14mm; }
 .warn { border: 1px solid #b00; background: #fff3f3; padding: 3mm; margin: 4mm 0; }
 .warn h3 { margin: 0 0 1mm; font-size: 10pt; color: #b00; }
 .warn ul { margin: 0; padding-left: 5mm; }
 .big { font-size: 11pt; }
</style></head><body>`;

// ---------- Feuille 1 : résumé ----------
html += `<div class="sheet">
<h1>Importation temporaire pour vente incertaine — formulaire 1187</h1>
<div class="meta">
 <b>Emplacement</b> ${esc(location.name)}<br>
 <b>Date</b> ${today}<br>
 <b>Référence 1187</b> ${esc(REF) || '—'}<br>
 <b>Taux appliqué</b> 1 EUR = ${RATE} CHF<br>
 <b>Origine des marchandises</b> ${esc(ORIGIN)}<br>
 <b>Poids net total</b> ${netKg.toFixed(3)} kg<br>
 <b>Poids brut total</b> ${GROSS !== null ? GROSS.toFixed(3) + ' kg (pesé)' : '— à compléter à la main'}<br>
 <b>Nombre de pièces</b> <span class="big">${totalPieces}</span><br>
 <b>Valeur douanière totale</b> <span class="big">${eur(totalCustomsEur)} EUR &nbsp;/&nbsp; ${chf(totalCustomsEur)} CHF</span>
</div>
<h2>Détail par type de produit</h2>
<table><thead><tr>
 <th class="l">Type</th><th>Quantité</th><th>Poids net (kg)</th><th>Poids brut (kg)</th>
 <th>Valeur douanière CHF</th><th>Valeur douanière EUR</th>
 <th>Qté vendue</th><th>Qté restante</th><th>Poids vendu</th><th>Poids restant</th>
 <th>Valeur vendue</th><th>Valeur restante</th>
</tr></thead><tbody>`;

const grossRatio = GROSS !== null && netKg > 0 ? GROSS / netKg : null;
for (const [type, t] of [...byType.entries()].sort((a, b) => b[1].qty - a[1].qty)) {
  const gross = grossRatio ? (t.netG / 1000) * grossRatio : null;
  html += `<tr>
   <td class="l">${esc(type)}</td>
   <td>${t.qty}</td>
   <td>${kg(t.netG)}</td>
   <td>${gross !== null ? gross.toFixed(3) : '—'}</td>
   <td>${chf(t.customsEur)}</td>
   <td>${eur(t.customsEur)}</td>
   <td></td><td></td><td></td><td></td><td></td><td></td>
  </tr>`;
}
html += `</tbody><tfoot><tr>
 <td class="l">TOTAL</td><td>${totalPieces}</td><td>${kg(totalNetG)}</td>
 <td>${GROSS !== null ? GROSS.toFixed(3) : '—'}</td>
 <td>${chf(totalCustomsEur)}</td><td>${eur(totalCustomsEur)}</td>
 <td></td><td></td><td></td><td></td><td></td><td></td>
</tr></tfoot></table>
<p style="font-size:8pt;color:#555;margin-top:3mm">
 Les colonnes vendue / restante sont à remplir au retour, pour le formulaire 11.74.
 Le poids brut par type est réparti au prorata du poids net.
</p>`;

const anyProblem = problems.noWeight.length || problems.noRule.length || problems.mismatch.length || problems.noPrice.length;
if (anyProblem) {
  html += `<div class="warn"><h3>À vérifier avant de présenter ce document</h3><ul>`;
  if (problems.noWeight.length) html += `<li><b>${problems.noWeight.length} ligne(s) sans poids</b> — poids compté comme 0 dans les totaux.</li>`;
  if (problems.noRule.length) html += `<li><b>${problems.noRule.length} ligne(s) sans règle de prix</b> — coût textile et impression non décomposables.</li>`;
  if (problems.mismatch.length) html += `<li><b>${problems.mismatch.length} ligne(s) où textile + impression ne retombe pas sur le coût enregistré.</b></li>`;
  if (problems.noPrice.length) html += `<li><b>${problems.noPrice.length} ligne(s) sans prix de vente</b> — donc sans valeur douanière.</li>`;
  html += `</ul><p style="margin:2mm 0 0">Les lignes concernées sont surlignées en rouge sur les feuilles produit.</p></div>`;
}
html += `</div>`;

// ---------- Une feuille par produit ----------
for (const { product, rows } of sheets) {
  rows.sort((a, b) => (a.color || '').localeCompare(b.color || '') || sizeRank(a.size) - sizeRank(b.size));
  const sQty = rows.reduce((s, r) => s + r.qty, 0);
  const sNet = rows.reduce((s, r) => s + (r.grams || 0) * r.qty, 0);
  const sVal = rows.reduce((s, r) => s + (r.total || 0) * r.qty, 0);
  const sCus = rows.reduce((s, r) => s + r.price * r.qty, 0);

  html += `<div class="sheet">
  <h2>${esc(product.title)}</h2>
  <div class="meta"><b>Type</b> ${esc(product.product_type || '—')} &nbsp;·&nbsp;
   <b style="min-width:auto">Origine</b> ${esc(ORIGIN)} &nbsp;·&nbsp;
   <b style="min-width:auto">Taux</b> 1 EUR = ${RATE} CHF &nbsp;·&nbsp;
   <b style="min-width:auto">Emplacement</b> ${esc(location.name)} &nbsp;·&nbsp; ${today}</div>
  <table><thead><tr>
   <th class="l">Image</th><th class="l">Référence</th><th class="l">Taille</th><th class="l">Couleur</th>
   <th>Qté apportée</th><th>Vendu</th><th>Poids unit. (kg)</th>
   <th>Textile HT €</th><th>Impression HT €</th><th>Valeur totale €</th>
   <th>Textile CHF</th><th>Impression CHF</th><th>Val. unit. CHF</th>
   <th>Valeur douanière €</th><th class="l">Origine</th>
  </tr></thead><tbody>`;

  for (const r of rows) {
    html += `<tr class="${r.incomplete ? 'incomplete' : ''}">
     <td class="l">${r.image ? `<img src="${esc(r.image)}" alt="">` : ''}</td>
     <td class="l">${esc(r.ref)}</td>
     <td class="l">${esc(r.size)}</td>
     <td class="l">${esc(r.color)}</td>
     <td>${r.qty}</td>
     <td></td>
     <td>${r.grams ? kg(r.grams) : '<b>?</b>'}</td>
     <td>${r.textile !== null ? eur(r.textile) : '<b>?</b>'}</td>
     <td>${r.print !== null ? eur(r.print) : '<b>?</b>'}</td>
     <td>${r.total !== null ? eur(r.total * r.qty) : '<b>?</b>'}</td>
     <td>${r.textile !== null ? chf(r.textile) : '<b>?</b>'}</td>
     <td>${r.print !== null ? chf(r.print) : '<b>?</b>'}</td>
     <td>${r.total !== null ? chf(r.total) : '<b>?</b>'}</td>
     <td>${eur(r.price)}</td>
     <td class="l">${esc(ORIGIN)}</td>
    </tr>`;
  }

  html += `</tbody><tfoot><tr>
   <td class="l" colspan="4">Sous-total — ${esc(product.title)}</td>
   <td>${sQty}</td><td></td><td>${kg(sNet)}</td>
   <td colspan="2"></td><td>${eur(sVal)}</td>
   <td colspan="3"></td><td>${eur(sCus)}</td><td></td>
  </tr></tfoot></table></div>`;
}

html += `</body></html>`;

const outDir = path.join(repoRoot, 'exports');
fs.mkdirSync(outDir, { recursive: true });
const out = arg('out') || path.join(outDir, `douane-${location.name.replace(/[^\w]+/g, '-')}-${today}.html`);
fs.writeFileSync(out, html, 'utf8');

console.log(`\nEmplacement           : ${location.name}`);
console.log(`Pièces                : ${totalPieces}`);
console.log(`Produits (feuilles)   : ${sheets.length}`);
console.log(`Poids net             : ${netKg.toFixed(3)} kg`);
console.log(`Valeur douanière      : ${eur(totalCustomsEur)} EUR  /  ${chf(totalCustomsEur)} CHF`);
console.log(`\nÀ vérifier :`);
console.log(`  sans poids          : ${problems.noWeight.length}`);
console.log(`  sans règle de prix  : ${problems.noRule.length}`);
console.log(`  coût incohérent     : ${problems.mismatch.length}`);
console.log(`  sans prix de vente  : ${problems.noPrice.length}`);
console.log(`\nDocument : ${out}`);
console.log(`Ouvre-le dans un navigateur puis Ctrl+P → Enregistrer en PDF (paysage).`);
