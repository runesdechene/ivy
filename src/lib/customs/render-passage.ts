/**
 * Rendu imprimable d'un passage en douane, DEPUIS L'INSTANTANÉ FIGÉ.
 *
 * Rien n'est relu du stock courant : le document reflète ce qui a réellement
 * passé la frontière, même des semaines plus tard. Les paramètres (taux, TVA,
 * prix, poids brut) viennent du passage et restent modifiables ; l'instantané,
 * lui, ne bouge jamais.
 *
 * Passage ouvert  → formulaire 1187 (importation temporaire).
 * Passage clôturé → 11.74, avec la réconciliation parti / vendu / revenu.
 */

export interface PassageRow {
  shop_id: string;
  location_name: string;
  status: string;
  reference: string | null;
  departed_on: string;
  returned_on: string | null;
  eur_to_chf: number;
  vat_pct: number;
  gross_weight_kg: number | null;
  origin: string;
  prices_chf_ttc: Record<string, number>;
  /** Libelle douanier par type : { "Le Confort": "T-shirt coton" }. */
  customs_labels?: Record<string, string>;
  /** Poids des caisses par type, en kg. */
  packaging_kg?: Record<string, number>;
}

export interface PassageItem {
  product_title: string;
  product_type: string | null;
  image_url: string | null;
  size: string | null;
  color: string | null;
  qty_departed: number;
  qty_returned: number | null;
  qty_sold_recorded: number | null;
  weight_grams: number | null;
  unit_cost_textile: number | null;
  unit_cost_print: number | null;
  unit_price_eur: number | null;
  incomplete: boolean;
}

const SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'];
const sizeRank = (s: string | null) => {
  const i = SIZES.indexOf((s ?? '').trim().toUpperCase());
  return i === -1 ? 999 : i;
};

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

const CSS = `
 @page { size: A4 landscape; margin: 10mm; }
 body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 9pt; color: #1a1a1a; }
 h1 { font-size: 15pt; margin: 0 0 2mm; }
 h2 { font-size: 12pt; margin: 0 0 1mm; }
 .sheet { page-break-after: always; }
 .sheet:last-child { page-break-after: auto; }
 .meta { margin-bottom: 4mm; }
 .meta b { display: inline-block; min-width: 46mm; }
 table { border-collapse: collapse; width: 100%; page-break-inside: avoid; }
 th, td { border: 1px solid #999; padding: 1.2mm 1.6mm; text-align: right; }
 th { background: #eee; text-align: center; font-size: 8pt; }
 td.l, th.l { text-align: left; }
 tr.incomplete td { background: #ffecec; }
 tr.ecart td { background: #fff6e5; }
 tfoot td { font-weight: bold; background: #f4f4f4; }
 .prodhead { display: flex; align-items: center; gap: 4mm; margin-bottom: 2mm; }
 .prodhead img { height: 22mm; border: 1px solid #ccc; }
 .dense table { font-size: 7.4pt; }
 .dense th, .dense td { padding: 0.5mm 1.2mm; }
 .dense .prodhead img { height: 16mm; }
 .warn { border: 1px solid #b00; background: #fff3f3; padding: 3mm; margin: 4mm 0; }
 .warn h3 { margin: 0 0 1mm; font-size: 10pt; color: #b00; }
 .big { font-size: 11pt; }
 /* Colonnes du retour, imprimees vides a l'aller pour etre remplies a la main. */
 td.tofill { background: #fafafa; }
 th.tofill { color: #666; font-style: italic; }
 /* Ces colonnes se remplissent a la cloture, par comparaison des deux instantanes. */
 .noprint { margin: 0 0 5mm; padding: 3mm; background: #eef4ee; border: 1px solid #9ab; }
 @media print { .noprint { display: none; } }
`;

export function renderPassage(
  passage: PassageRow,
  items: PassageItem[],
  options: { onlySummary?: boolean } = {},
): string {
  const closed = passage.status === 'closed';
  const rate = Number(passage.eur_to_chf);
  const vatDiv = 1 + Number(passage.vat_pct) / 100;
  const prices = passage.prices_chf_ttc ?? {};
  const labels = passage.customs_labels ?? {};
  /** Ce que le douanier lit : le libelle saisi, a defaut le nom du type. */
  const labelOf = (type: string) => labels[type] || type;
  const packaging = passage.packaging_kg ?? {};
  const hasPackaging = Object.values(packaging).some(v => Number(v) > 0);

  const num = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
  // Poids arrondis au dixieme de kilo : trois decimales n'apportent rien a un
  // douanier, et l'entier ecraserait les petites lignes (0,72 kg -> 1 kg).
  const kg = (g: number) => (g / 1000).toFixed(1);
  const kgv = (v: number) => v.toFixed(1);

  /** Prix de vente TTC en CHF : celui saisi pour le type, sinon le prix Ivy converti. */
  const ttcOf = (it: PassageItem) => {
    const saisi = prices[it.product_type ?? ''];
    return saisi && saisi > 0 ? saisi : (Number(it.unit_price_eur) || 0) * rate;
  };
  const htOf = (it: PassageItem) => ttcOf(it) / vatDiv;
  /**
   * Valeur en douane : le prix d'ACHAT, pas le prix de vente. C'est le coût du
   * textile plus celui de l'impression — déjà hors taxe, rien à retirer.
   * Exprimée en euros ; la colonne CHF applique le taux du passage.
   */
  const customsEurOf = (it: PassageItem) =>
    (Number(it.unit_cost_textile) || 0) + (Number(it.unit_cost_print) || 0);
  const customsChfOf = (it: PassageItem) => customsEurOf(it) * rate;
  /** TVA due a l'importation en Suisse : elle se calcule sur la valeur douaniere HT. */
  const vatOnImport = (ht: number) => ht * (Number(passage.vat_pct) / 100);

  // Agrégats
  let pieces = 0, netG = 0, customsChf = 0;
  let returned = 0, sold = 0, ecarts = 0;
  const byType = new Map<string, { qty: number; netG: number; chf: number; ret: number; sold: number }>();
  const byProduct = new Map<string, { title: string; image: string | null; type: string | null; rows: PassageItem[] }>();
  const problems = { noWeight: 0, noRule: 0, noPrice: 0 };

  for (const it of items) {
    const g = it.weight_grams ?? 0;
    pieces += it.qty_departed;
    netG += g * it.qty_departed;
    customsChf += customsChfOf(it) * it.qty_departed;
    if (closed) {
      returned += it.qty_returned ?? 0;
      sold += it.qty_sold_recorded ?? 0;
      if (it.qty_departed - (it.qty_returned ?? 0) - (it.qty_sold_recorded ?? 0) !== 0) ecarts++;
    }
    if (!it.weight_grams) problems.noWeight++;
    if (it.unit_cost_textile === null) problems.noRule++;
    if (!it.unit_price_eur) problems.noPrice++;

    const t = it.product_type ?? '(sans type)';
    const agg = byType.get(t) ?? { qty: 0, netG: 0, chf: 0, ret: 0, sold: 0 };
    agg.qty += it.qty_departed;
    agg.netG += g * it.qty_departed;
    agg.chf += customsChfOf(it) * it.qty_departed;
    agg.ret += it.qty_returned ?? 0;
    agg.sold += it.qty_sold_recorded ?? 0;
    byType.set(t, agg);

    const key = it.product_title;
    const p = byProduct.get(key) ?? { title: it.product_title, image: it.image_url, type: it.product_type, rows: [] };
    p.rows.push(it);
    byProduct.set(key, p);
  }

  const globalGross = passage.gross_weight_kg !== null ? Number(passage.gross_weight_kg) : null;
  // Le brut d'un type = son net + le poids de SES caisses. On ne retombe sur le
  // poids brut global (reparti au prorata) que si aucune caisse n'est renseignee.
  const packagingOf = (type: string) => Number(packaging[type]) || 0;
  const totalPackaging = [...byType.keys()].reduce((n, t) => n + packagingOf(t), 0);
  const grossKg = hasPackaging ? netG / 1000 + totalPackaging : globalGross;
  const grossRatio = !hasPackaging && globalGross !== null && netG > 0 ? globalGross / (netG / 1000) : null;
  const grossOfType = (type: string, typeNetG: number) =>
    hasPackaging
      ? typeNetG / 1000 + packagingOf(type)
      : grossRatio !== null ? (typeNetG / 1000) * grossRatio : null;
  const titre = closed
    ? 'Réexportation après vente incertaine — formulaire 11.74'
    : 'Importation temporaire pour vente incertaine — formulaire 1187';

  let html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Douane suisse — ${esc(passage.location_name)} — ${esc(passage.departed_on)}</title>
<style>${CSS}</style></head><body>
<div class="noprint"><b>Ctrl+P</b> puis « Enregistrer en PDF », orientation <b>paysage</b>.
Coche « Graphiques d'arrière-plan » pour que les lignes signalées restent visibles. Ce bandeau ne s'imprime pas.</div>`;

  // ---------- Feuille de résumé ----------
  html += `<div class="sheet"><h1>${titre}</h1>
<div class="meta">
 <b>Emplacement</b> ${esc(passage.location_name)}<br>
 <b>Date de départ</b> ${esc(passage.departed_on)}<br>
 ${closed ? `<b>Date de retour</b> ${esc(passage.returned_on ?? '—')}<br>` : ''}
 <b>Référence 1187</b> ${esc(passage.reference) || '—'}<br>
 <b>Taux appliqué</b> 1 EUR = ${rate} CHF<br>
 <b>TVA suisse déduite</b> ${passage.vat_pct} %<br>
 <b>Origine des marchandises</b> ${esc(passage.origin)}<br>
 <b>Poids net total</b> ${kgv(netG / 1000)} kg<br>
 <b>Poids brut total</b> ${grossKg !== null ? kgv(grossKg) + ' kg' + (hasPackaging ? ' (net + caisses)' : ' (pesé)') : '— à compléter'}<br>
 <b>Pièces déclarées</b> <span class="big">${pieces}</span><br>
 ${closed ? `<b>Revenues</b> <span class="big">${returned}</span> &nbsp;·&nbsp; <b style="min-width:auto">vendues (caisse)</b> <span class="big">${sold}</span><br>` : ''}
 <b>Valeur douanière totale</b> <span class="big">${num(customsChf / rate)} EUR &nbsp;/&nbsp; ${num(customsChf)} CHF</span><br>
 <b>TVA à l'import (${passage.vat_pct} %)</b> <span class="big">${num(vatOnImport(customsChf))} CHF</span>
</div>
<p style="font-size:8pt;color:#555;margin:-2mm 0 3mm">
 <b>Valeur en douane = prix d'achat</b> (coût du textile + coût de l'impression), hors taxe par nature.
 Conversion en francs au taux de ${rate}. Les prix de vente ci-dessous ne servent qu'à situer la marchandise ;
 ils n'entrent pas dans la valeur déclarée.
</p>

<h2>Prix de vente pratiqués en Suisse</h2>
<table style="width:auto;margin-bottom:4mm"><thead><tr>
 <th class="l">Type</th><th>Prix TTC (CHF)</th><th>dont TVA</th><th>Prix HT (CHF)</th>
</tr></thead><tbody>${[...byType.keys()].sort().map(t => {
    const ttc = prices[t];
    if (!ttc) return `<tr><td class="l">${esc(t)}</td><td colspan="3">converti depuis le prix Ivy</td></tr>`;
    return `<tr><td class="l">${esc(t)}</td><td>${num(ttc)}</td><td>${num(ttc - ttc / vatDiv)}</td><td><b>${num(ttc / vatDiv)}</b></td></tr>`;
  }).join('')}</tbody></table>

<h2>Détail par type de produit</h2>
<table><thead><tr>
 <th class="l">Objet</th><th class="l">Type Ivy</th><th>Quantité</th><th>Poids net (kg)</th><th>Caisses (kg)</th><th>Poids brut (kg)</th>
 <th>Valeur douanière au départ<br>HT (EUR)</th><th>Valeur douanière au départ<br>HT (CHF)</th><th>TVA import CHF</th>
 ${closed
    ? '<th>Qté restante</th><th>Qté vendue</th><th>Poids restant (kg)</th><th>Poids vendu (kg)</th><th>Valeur restante CHF</th><th>Valeur vendue CHF</th>'
    : '<th class="tofill">Qté restante</th><th class="tofill">Qté vendue</th><th class="tofill">Poids restant</th><th class="tofill">Poids vendu</th><th class="tofill">Valeur restante</th><th class="tofill">Valeur vendue</th>'}
</tr></thead><tbody>`;

  for (const [type, t] of [...byType.entries()].sort((a, b) => b[1].qty - a[1].qty)) {
    const gross = grossOfType(type, t.netG);
    const unitHt = t.qty > 0 ? t.chf / t.qty : 0;
    html += `<tr><td class="l"><b>${esc(labelOf(type))}</b></td><td class="l">${esc(type)}</td><td>${t.qty}</td><td>${kg(t.netG)}</td>` +
      `<td>${hasPackaging ? kgv(packagingOf(type)) : '—'}</td>` +
      `<td>${gross !== null ? kgv(gross) : '—'}</td>` +
      `<td>${num(t.chf / rate)}</td><td>${num(t.chf)}</td><td>${num(vatOnImport(t.chf))}</td>` +
      (closed
        ? (() => {
            // « Vendu » au sens douanier : ce qui est physiquement resté en Suisse,
            // soit parti − revenu. Le chiffre de la caisse sert de contrôle ailleurs.
            const reste = t.ret;
            const vendu = Math.max(0, t.qty - t.ret);
            const unitG = t.qty > 0 ? t.netG / t.qty : 0;
            return `<td>${reste}</td><td>${vendu}</td>` +
              `<td>${kg(unitG * reste)}</td><td>${kg(unitG * vendu)}</td>` +
              `<td>${num(unitHt * reste)}</td><td>${num(unitHt * vendu)}</td>`;
          })()
        : `<td class="tofill"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td>`) +
      `</tr>`;
  }

  html += `</tbody><tfoot><tr><td class="l" colspan="2">TOTAL</td><td>${pieces}</td><td>${kg(netG)}</td>` +
    `<td>${hasPackaging ? kgv(totalPackaging) : '—'}</td>` +
    `<td>${grossKg !== null ? kgv(grossKg) : '—'}</td>` +
    `<td>${num(customsChf / rate)}</td><td>${num(customsChf)}</td><td>${num(vatOnImport(customsChf))}</td>` +
    (closed
      ? (() => {
          const venduTotal = Math.max(0, pieces - returned);
          const unitG = pieces > 0 ? netG / pieces : 0;
          const unitHt = pieces > 0 ? customsChf / pieces : 0;
          return `<td>${returned}</td><td>${venduTotal}</td>` +
            `<td>${kg(unitG * returned)}</td><td>${kg(unitG * venduTotal)}</td>` +
            `<td>${num(unitHt * returned)}</td><td>${num(unitHt * venduTotal)}</td>`;
        })()
      : `<td class="tofill"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td>`) +
    `</tr></tfoot></table>`;

  if (!closed) {
    html += `<p style="font-size:8pt;color:#555;margin-top:3mm">
     Les six colonnes de droite se remplissent automatiquement à la clôture du passage,
     en comparant l'instantané de départ au stock constaté au retour. Rien n'est à saisir à la main.
     Le poids brut par type est réparti au prorata du poids net.</p>`;
  } else if (closed) {
    const venduTotal = Math.max(0, pieces - returned);
    const unitHt = pieces > 0 ? customsChf / pieces : 0;
    html += `<p style="font-size:8pt;color:#555;margin-top:3mm">
     TVA réellement due : elle ne porte que sur ce qui est resté en Suisse, soit
     <b>${venduTotal}</b> pièce(s) pour <b>${num(unitHt * venduTotal)} CHF HT</b>,
     donc <b>${num(vatOnImport(unitHt * venduTotal))} CHF</b> de TVA — à opposer aux
     ${num(vatOnImport(customsChf))} CHF avancés à l'entrée.
     « Vendu » vaut ici « parti − revenu » ; le chiffre de la caisse figure sur les feuilles produit.</p>`;
  }
  if (closed && ecarts > 0) {
    html += `<div class="warn"><h3>${ecarts} ligne(s) avec un écart</h3>
     <p style="margin:0">Sur ces lignes, « parti − revenu » ne correspond pas aux ventes enregistrées à la caisse.
     L'écart correspond à de la casse, un cadeau, ou une pièce partie sans passer en caisse. Les lignes concernées sont surlignées.</p></div>`;
  }

  const anyProblem = problems.noWeight || problems.noRule || problems.noPrice;
  if (anyProblem) {
    html += `<div class="warn"><h3>Données incomplètes au moment de l'instantané</h3><ul>`;
    if (problems.noWeight) html += `<li><b>${problems.noWeight} ligne(s) sans poids</b> — comptées comme 0.</li>`;
    if (problems.noRule) html += `<li><b>${problems.noRule} ligne(s) sans règle de prix</b> — coût non décomposable.</li>`;
    if (problems.noPrice) html += `<li><b>${problems.noPrice} ligne(s) sans prix de vente Ivy</b>.</li>`;
    html += `</ul></div>`;
  }
  html += `</div>`;

  // La feuille de resume seule : c'est ce que la douane demande en tete de dossier.
  if (options.onlySummary) return html + `</body></html>`;

  // ---------- Une feuille par produit ----------
  const sheets = [...byProduct.values()].sort(
    (a, b) => (a.type ?? '').localeCompare(b.type ?? '') || a.title.localeCompare(b.title),
  );

  for (const s of sheets) {
    s.rows.sort((a, b) => (a.color ?? '').localeCompare(b.color ?? '') || sizeRank(a.size) - sizeRank(b.size));
    const sQty = s.rows.reduce((n, r) => n + r.qty_departed, 0);
    const sNet = s.rows.reduce((n, r) => n + (r.weight_grams ?? 0) * r.qty_departed, 0);
    const sHt = s.rows.reduce((n, r) => n + customsChfOf(r) * r.qty_departed, 0);

    html += `<div class="sheet${s.rows.length > 24 ? ' dense' : ''}">
<div class="prodhead">${s.image ? `<img src="${esc(s.image)}" alt="">` : ''}<div><h2>${esc(s.title)}</h2></div></div>
<div class="meta"><b style="min-width:auto">Objet</b> ${esc(labelOf(s.type ?? '—'))} &nbsp;·&nbsp;
 <b style="min-width:auto">Origine</b> ${esc(passage.origin)} &nbsp;·&nbsp;
 <b style="min-width:auto">Taux</b> 1 EUR = ${rate} CHF &nbsp;·&nbsp;
 <b style="min-width:auto">Emplacement</b> ${esc(passage.location_name)} &nbsp;·&nbsp; ${esc(passage.departed_on)}</div>
<table><thead><tr>
 <th class="l">Taille</th><th class="l">Couleur</th><th>Qté apportée</th>
 ${closed ? '<th>Revenue</th><th>Vendue</th><th>Écart</th>' : '<th>Vendu</th>'}
 <th>Poids unit. (kg)</th><th>Textile HT €</th><th>Impression HT €</th>
 <th>Vente CHF TTC<br><i>(indicatif)</i></th><th>Valeur douanière<br>HT (EUR)</th><th>Valeur douanière<br>HT (CHF)</th><th>TVA import CHF</th><th class="l">Origine</th>
</tr></thead><tbody>`;

    for (const r of s.rows) {
      const ecart = closed ? r.qty_departed - (r.qty_returned ?? 0) - (r.qty_sold_recorded ?? 0) : 0;
      const cls = r.incomplete ? 'incomplete' : (closed && ecart !== 0 ? 'ecart' : '');
      html += `<tr class="${cls}">` +
        `<td class="l">${esc(r.size)}</td><td class="l">${esc(r.color)}</td><td>${r.qty_departed}</td>` +
        (closed
          ? `<td>${r.qty_returned ?? 0}</td><td>${r.qty_sold_recorded ?? 0}</td><td>${ecart !== 0 ? `<b>${ecart}</b>` : '0'}</td>`
          : `<td></td>`) +
        `<td>${r.weight_grams ? kg(r.weight_grams) : '<b>?</b>'}</td>` +
        `<td>${r.unit_cost_textile !== null ? num(r.unit_cost_textile) : '<b>?</b>'}</td>` +
        `<td>${r.unit_cost_print !== null ? num(r.unit_cost_print) : '<b>?</b>'}</td>` +
        `<td>${num(ttcOf(r))}</td>` +
        `<td><b>${num(customsEurOf(r))}</b></td><td><b>${num(customsChfOf(r))}</b></td>` +
        `<td>${num(vatOnImport(customsChfOf(r)))}</td>` +
        `<td class="l">${esc(passage.origin)}</td></tr>`;
    }

    html += `</tbody><tfoot><tr><td class="l" colspan="2">Sous-total — ${esc(s.title)}</td><td>${sQty}</td>` +
      (closed ? `<td colspan="3"></td>` : `<td></td>`) +
      `<td>${kg(sNet)}</td><td colspan="2"></td><td></td>` +
      `<td><b>${num(sHt / rate)}</b></td><td><b>${num(sHt)}</b></td>` +
      `<td><b>${num(vatOnImport(sHt))}</b></td><td></td>` +
      `</tr></tfoot></table></div>`;
  }

  return html + `</body></html>`;
}
