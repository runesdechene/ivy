import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Déclaration douanière suisse (formulaire 1187 — importation temporaire pour
 * vente incertaine). Produit un document HTML prêt à imprimer : une feuille de
 * résumé, puis une feuille par produit.
 *
 * Décomposition du coût, reprise de `/api/settings/price-rules/apply-ivy-stream` :
 *   textile    = price_rules.base_price + modificateurs d'OPTION
 *   impression = modificateurs de MÉTACHAMP
 *   total      = textile + impression, comparé à product_variants.cost
 *
 * Un écart n'est jamais corrigé en silence : la ligne est surlignée sur le
 * document et comptée dans l'encadré d'avertissement.
 */

export interface CustomsParams {
  /** Taux de conversion EUR → CHF, saisi à la main (taux officiel du jour). */
  rate: number;
  /** Poids brut total en kg, caisses pesées. Null = à compléter à la main. */
  grossKg: number | null;
  /** Numéro de formulaire 1187, optionnel. */
  reference: string;
  /** Code d'origine des marchandises. */
  origin: string;
}

interface VariantRow {
  id: string;
  product_id: string;
  shopify_id: string | null;
  title: string | null;
  sku: string | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  cost: number | null;
  price: number | null;
  /** Poids saisi dans Ivy. Fait foi sur celui de Shopify : pour une variante
   *  supprimee de Shopify, Ivy en est la seule source possible. */
  weight_grams: number | null;
}

interface ProductRow {
  id: string;
  title: string;
  product_type: string | null;
  image_url: string | null;
  option1_name: string | null;
  option2_name: string | null;
  option3_name: string | null;
}

interface RuleRow {
  id: string;
  sku: string | null;
  base_price: number | null;
  product_type: string | null;
  is_active: boolean | null;
}

interface ModifierRow {
  price_rule_id: string;
  metafield_namespace: string;
  metafield_key: string;
  metafield_value: string;
  modifier_amount: number | null;
}

interface OptionModifierRow {
  price_rule_id: string;
  option_name: string | null;
  option_value: string | null;
  modifier_amount: number | null;
}

interface MetafieldRow {
  variant_id: string;
  namespace: string;
  key: string;
  value: string | null;
}

interface Line {
  type: string;
  image: string | null;
  ref: string;
  size: string;
  color: string;
  qty: number;
  grams: number | null;
  textile: number | null;
  print: number | null;
  total: number | null;
  price: number;
  incomplete: boolean;
}

export interface CustomsResult {
  html: string;
  locationName: string;
  totalPieces: number;
  netKg: number;
  customsValueEur: number;
  sheets: number;
  problems: { noWeight: number; noRule: number; mismatch: number; noPrice: number };
}

const SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'];
const sizeRank = (s: string): number => {
  const i = SIZES.indexOf((s || '').trim().toUpperCase());
  return i === -1 ? 999 : i;
};

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** PostgREST plafonne un select à 1000 lignes : on pagine avec un order explicite. */
async function readAll<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  apply: (q: ReturnType<SupabaseClient['from']>) => unknown,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase.from(table).select(columns).order('id').range(from, from + 999);
    query = apply(query as never) as typeof query;
    const { data, error } = await query;
    if (error) throw new Error(`${table} : ${error.message}`);
    const chunk = (data ?? []) as unknown as T[];
    if (chunk.length === 0) break;
    out.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return out;
}

function optionOf(variant: VariantRow, product: ProductRow, wanted: 'size' | 'color'): string {
  const pairs: [string | null, string | null][] = [
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

export async function buildCustomsDeclaration(
  supabase: SupabaseClient,
  shopId: string,
  locationShopifyId: string,
  params: CustomsParams,
): Promise<CustomsResult> {
  const { data: shop } = await supabase
    .from('shops')
    .select('shopify_url, shopify_token')
    .eq('id', shopId)
    .single();
  if (!shop) throw new Error('Boutique introuvable');

  const { data: location } = await supabase
    .from('locations')
    .select('name, shopify_id')
    .eq('shop_id', shopId)
    .eq('shopify_id', locationShopifyId)
    .maybeSingle();
  if (!location) throw new Error('Emplacement introuvable');

  const levels = await readAll<{ variant_id: string; quantity: number }>(
    supabase, 'inventory_levels', 'id, variant_id, quantity',
    q => (q as never as { eq: (a: string, b: string) => { gt: (a: string, b: number) => unknown } })
      .eq('location_id', locationShopifyId).gt('quantity', 0),
  );

  const variants = await readAll<VariantRow>(
    supabase, 'product_variants',
    'id, product_id, shopify_id, title, sku, option1, option2, option3, cost, price, weight_grams',
    q => q,
  );
  const products = await readAll<ProductRow>(
    supabase, 'products',
    'id, title, product_type, image_url, option1_name, option2_name, option3_name',
    q => (q as never as { eq: (a: string, b: string) => unknown }).eq('shop_id', shopId),
  );
  const rules = await readAll<RuleRow>(
    supabase, 'price_rules', 'id, sku, base_price, product_type, is_active',
    q => (q as never as { eq: (a: string, b: string) => unknown }).eq('shop_id', shopId),
  );
  const mods = await readAll<ModifierRow>(
    supabase, 'price_rule_modifiers',
    'id, price_rule_id, metafield_namespace, metafield_key, metafield_value, modifier_amount',
    q => q,
  );
  const optMods = await readAll<OptionModifierRow>(
    supabase, 'price_rule_option_modifiers',
    'id, price_rule_id, option_name, option_value, modifier_amount',
    q => q,
  );

  const V = new Map(variants.map(v => [v.id, v]));
  const P = new Map(products.map(p => [p.id, p]));

  // Métachamps des seules variantes en stock
  const metaByVariant = new Map<string, MetafieldRow[]>();
  const variantIds = levels.map(l => l.variant_id);
  for (let i = 0; i < variantIds.length; i += 200) {
    const batch = variantIds.slice(i, i + 200);
    const { data } = await supabase
      .from('variant_metafields')
      .select('variant_id, namespace, key, value')
      .in('variant_id', batch);
    for (const mf of (data ?? []) as MetafieldRow[]) {
      const list = metaByVariant.get(mf.variant_id) ?? [];
      list.push(mf);
      metaByVariant.set(mf.variant_id, list);
    }
  }

  // Poids : lus chez Shopify (variant.grams). Ivy ne les stocke pas encore.
  const gramsByVariant = new Map<string, number>();
  let url: string | null = `https://${shop.shopify_url}/admin/api/2024-01/products.json?limit=250`;
  while (url) {
    const r: Response = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': shop.shopify_token },
    });
    if (!r.ok) throw new Error(`Shopify ${r.status} sur products.json`);
    const body = (await r.json()) as { products?: { variants?: { id: number; grams?: number }[] }[] };
    for (const p of body.products ?? []) {
      for (const v of p.variants ?? []) gramsByVariant.set(String(v.id), v.grams ?? 0);
    }
    const link = r.headers.get('link') ?? '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }

  const modsByRule = new Map<string, ModifierRow[]>();
  for (const m of mods) {
    const l = modsByRule.get(m.price_rule_id) ?? [];
    l.push(m);
    modsByRule.set(m.price_rule_id, l);
  }
  const optModsByRule = new Map<string, OptionModifierRow[]>();
  for (const m of optMods) {
    const l = optModsByRule.get(m.price_rule_id) ?? [];
    l.push(m);
    optModsByRule.set(m.price_rule_id, l);
  }

  function breakdown(variant: VariantRow, product: ProductRow) {
    const sku = (variant.sku ?? '').toUpperCase();
    const rule = rules.find(
      r =>
        r.is_active !== false &&
        sku.startsWith((r.sku ?? '').toUpperCase()) &&
        (!r.product_type || r.product_type === product.product_type),
    );
    if (!rule) return { textile: null, print: null, total: null, matched: false, mismatch: false, recorded: 0 };

    let textile = Number(rule.base_price) || 0;
    let print = 0;

    const metafields = metaByVariant.get(variant.id) ?? [];
    for (const mod of modsByRule.get(rule.id) ?? []) {
      const hit = metafields.find(
        mf =>
          mf.namespace === mod.metafield_namespace &&
          mf.key === mod.metafield_key &&
          mf.value === mod.metafield_value,
      );
      if (hit) print += Number(mod.modifier_amount) || 0;
    }

    const selected: { name: string; value: string }[] = [];
    if (variant.option1) selected.push({ name: product.option1_name ?? 'Option 1', value: variant.option1 });
    if (variant.option2) selected.push({ name: product.option2_name ?? 'Option 2', value: variant.option2 });
    if (variant.option3) selected.push({ name: product.option3_name ?? 'Option 3', value: variant.option3 });

    for (const om of optModsByRule.get(rule.id) ?? []) {
      const hit = selected.find(
        o =>
          o.name.toLowerCase() === (om.option_name ?? '').toLowerCase() &&
          o.value.toLowerCase() === (om.option_value ?? '').toLowerCase(),
      );
      if (hit) textile += Number(om.modifier_amount) || 0;
    }

    const total = Math.round((textile + print) * 100) / 100;
    const recorded = Number(variant.cost) || 0;
    return { textile, print, total, matched: true, mismatch: Math.abs(total - recorded) >= 0.005, recorded };
  }

  const byProduct = new Map<string, { product: ProductRow; rows: Line[] }>();
  const byType = new Map<string, { qty: number; netG: number; customsEur: number }>();
  const problems = { noWeight: 0, noRule: 0, mismatch: 0, noPrice: 0 };
  let totalPieces = 0;
  let totalNetG = 0;
  let totalCustomsEur = 0;

  for (const lvl of levels) {
    const v = V.get(lvl.variant_id);
    if (!v) continue;
    const p = P.get(v.product_id);
    if (!p) continue;

    // Ivy d'abord : une variante supprimee de Shopify n'a de poids que dans Ivy,
    // et un poids saisi a la main ne doit jamais etre supplante par Shopify.
    const grams = v.weight_grams ?? gramsByVariant.get(String(v.shopify_id ?? '')) ?? null;
    const b = breakdown(v, p);
    const price = Number(v.price) || 0;
    const qty = lvl.quantity;

    if (!grams) problems.noWeight++;
    if (!b.matched) problems.noRule++;
    else if (b.mismatch) problems.mismatch++;
    if (!price) problems.noPrice++;

    const line: Line = {
      type: p.product_type ?? '(sans type)',
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
      incomplete: !grams || !b.matched || b.mismatch || !price,
    };

    const entry = byProduct.get(p.id) ?? { product: p, rows: [] };
    entry.rows.push(line);
    byProduct.set(p.id, entry);

    totalPieces += qty;
    totalNetG += (grams ?? 0) * qty;
    totalCustomsEur += price * qty;

    const t = byType.get(line.type) ?? { qty: 0, netG: 0, customsEur: 0 };
    t.qty += qty;
    t.netG += (grams ?? 0) * qty;
    t.customsEur += price * qty;
    byType.set(line.type, t);
  }

  const { rate, grossKg, reference, origin } = params;
  const eur = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
  const chf = (n: number) => (Math.round(n * rate * 100) / 100).toFixed(2);
  const kg = (g: number) => (g / 1000).toFixed(3);
  const today = new Date().toISOString().slice(0, 10);
  const netKg = totalNetG / 1000;

  const sheets = [...byProduct.values()].sort(
    (a, b) =>
      (a.product.product_type ?? '').localeCompare(b.product.product_type ?? '') ||
      a.product.title.localeCompare(b.product.title),
  );

  let html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Douane suisse — ${esc(location.name)} — ${today}</title>
<style>
 @page { size: A4 landscape; margin: 10mm; }
 body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 9pt; color: #1a1a1a; }
 h1 { font-size: 15pt; margin: 0 0 2mm; }
 h2 { font-size: 12pt; margin: 0 0 1mm; }
 .sheet { page-break-after: always; }
 .sheet:last-child { page-break-after: auto; }
 .meta { margin-bottom: 4mm; }
 .meta b { display: inline-block; min-width: 44mm; }
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
 .noprint { margin: 0 0 5mm; padding: 3mm; background: #eef4ee; border: 1px solid #9ab; }
 @media print { .noprint { display: none; } }
</style></head><body>
<div class="noprint"><b>Ctrl+P</b> puis « Enregistrer en PDF », orientation <b>paysage</b>. Ce bandeau ne s'imprime pas.</div>`;

  html += `<div class="sheet">
<h1>Importation temporaire pour vente incertaine — formulaire 1187</h1>
<div class="meta">
 <b>Emplacement</b> ${esc(location.name)}<br>
 <b>Date</b> ${today}<br>
 <b>Référence 1187</b> ${esc(reference) || '—'}<br>
 <b>Taux appliqué</b> 1 EUR = ${rate} CHF<br>
 <b>Origine des marchandises</b> ${esc(origin)}<br>
 <b>Poids net total</b> ${netKg.toFixed(3)} kg<br>
 <b>Poids brut total</b> ${grossKg !== null ? grossKg.toFixed(3) + ' kg (pesé)' : '— à compléter à la main'}<br>
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

  const grossRatio = grossKg !== null && netKg > 0 ? grossKg / netKg : null;
  for (const [type, t] of [...byType.entries()].sort((a, b) => b[1].qty - a[1].qty)) {
    const gross = grossRatio !== null ? (t.netG / 1000) * grossRatio : null;
    html += `<tr><td class="l">${esc(type)}</td><td>${t.qty}</td><td>${kg(t.netG)}</td>` +
      `<td>${gross !== null ? gross.toFixed(3) : '—'}</td>` +
      `<td>${chf(t.customsEur)}</td><td>${eur(t.customsEur)}</td>` +
      `<td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
  }

  html += `</tbody><tfoot><tr><td class="l">TOTAL</td><td>${totalPieces}</td><td>${kg(totalNetG)}</td>` +
    `<td>${grossKg !== null ? grossKg.toFixed(3) : '—'}</td>` +
    `<td>${chf(totalCustomsEur)}</td><td>${eur(totalCustomsEur)}</td>` +
    `<td></td><td></td><td></td><td></td><td></td><td></td></tr></tfoot></table>
<p style="font-size:8pt;color:#555;margin-top:3mm">
 Les colonnes vendue / restante se remplissent au retour, pour le formulaire 11.74.
 Le poids brut par type est réparti au prorata du poids net.
</p>`;

  const anyProblem = problems.noWeight || problems.noRule || problems.mismatch || problems.noPrice;
  if (anyProblem) {
    html += `<div class="warn"><h3>À vérifier avant de présenter ce document</h3><ul>`;
    if (problems.noWeight) html += `<li><b>${problems.noWeight} ligne(s) sans poids</b> — comptées comme 0, le poids net total est sous-estimé.</li>`;
    if (problems.noRule) html += `<li><b>${problems.noRule} ligne(s) sans règle de prix</b> — coût textile et impression non décomposables.</li>`;
    if (problems.mismatch) html += `<li><b>${problems.mismatch} ligne(s) où textile + impression ne retombe pas sur le coût enregistré.</b></li>`;
    if (problems.noPrice) html += `<li><b>${problems.noPrice} ligne(s) sans prix de vente</b> — donc sans valeur douanière.</li>`;
    html += `</ul><p style="margin:2mm 0 0">Les lignes concernées sont surlignées en rouge sur les feuilles produit.</p></div>`;
  }
  html += `</div>`;

  for (const { product, rows } of sheets) {
    rows.sort((a, b) => (a.color || '').localeCompare(b.color || '') || sizeRank(a.size) - sizeRank(b.size));
    const sQty = rows.reduce((s, r) => s + r.qty, 0);
    const sNet = rows.reduce((s, r) => s + (r.grams ?? 0) * r.qty, 0);
    const sVal = rows.reduce((s, r) => s + (r.total ?? 0) * r.qty, 0);
    const sCus = rows.reduce((s, r) => s + r.price * r.qty, 0);

    html += `<div class="sheet"><h2>${esc(product.title)}</h2>
<div class="meta"><b style="min-width:auto">Type</b> ${esc(product.product_type ?? '—')} &nbsp;·&nbsp;
 <b style="min-width:auto">Origine</b> ${esc(origin)} &nbsp;·&nbsp;
 <b style="min-width:auto">Taux</b> 1 EUR = ${rate} CHF &nbsp;·&nbsp;
 <b style="min-width:auto">Emplacement</b> ${esc(location.name)} &nbsp;·&nbsp; ${today}</div>
<table><thead><tr>
 <th class="l">Image</th><th class="l">Référence</th><th class="l">Taille</th><th class="l">Couleur</th>
 <th>Qté apportée</th><th>Vendu</th><th>Poids unit. (kg)</th>
 <th>Textile HT €</th><th>Impression HT €</th><th>Valeur totale €</th>
 <th>Textile CHF</th><th>Impression CHF</th><th>Val. unit. CHF</th>
 <th>Valeur douanière €</th><th class="l">Origine</th>
</tr></thead><tbody>`;

    for (const r of rows) {
      html += `<tr class="${r.incomplete ? 'incomplete' : ''}">` +
        `<td class="l">${r.image ? `<img src="${esc(r.image)}" alt="">` : ''}</td>` +
        `<td class="l">${esc(r.ref)}</td><td class="l">${esc(r.size)}</td><td class="l">${esc(r.color)}</td>` +
        `<td>${r.qty}</td><td></td>` +
        `<td>${r.grams ? kg(r.grams) : '<b>?</b>'}</td>` +
        `<td>${r.textile !== null ? eur(r.textile) : '<b>?</b>'}</td>` +
        `<td>${r.print !== null ? eur(r.print) : '<b>?</b>'}</td>` +
        `<td>${r.total !== null ? eur(r.total * r.qty) : '<b>?</b>'}</td>` +
        `<td>${r.textile !== null ? chf(r.textile) : '<b>?</b>'}</td>` +
        `<td>${r.print !== null ? chf(r.print) : '<b>?</b>'}</td>` +
        `<td>${r.total !== null ? chf(r.total) : '<b>?</b>'}</td>` +
        `<td>${eur(r.price)}</td><td class="l">${esc(origin)}</td></tr>`;
    }

    html += `</tbody><tfoot><tr><td class="l" colspan="4">Sous-total — ${esc(product.title)}</td>` +
      `<td>${sQty}</td><td></td><td>${kg(sNet)}</td><td colspan="2"></td><td>${eur(sVal)}</td>` +
      `<td colspan="3"></td><td>${eur(sCus)}</td><td></td></tr></tfoot></table></div>`;
  }

  html += `</body></html>`;

  return {
    html,
    locationName: location.name,
    totalPieces,
    netKg,
    customsValueEur: totalCustomsEur,
    sheets: sheets.length,
    problems,
  };
}
