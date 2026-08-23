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
  /** Titre et sous-titre libres de la feuille imprimee. */
  doc_titre?: string | null;
  doc_sous_titre?: string | null;
  raison_sociale?: string | null;
  nom_prenom?: string | null;
  adresse_siege?: string | null;
  adresse_exposition?: string | null;
  date_exposition?: string | null;
  date_retour_prevue?: string | null;
  date_apurement?: string | null;
  /** Position tarifaire, origine et TVA par type. Le code SH vient d'ici. */
  tariff_by_type?: Record<string, { position?: string; origine?: string; tva?: number }>;
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
 img { height: 13mm; border: 1px solid #ddd; }
 .dense img { height: 9mm; }
 .dense table { font-size: 7.4pt; }
 .dense th, .dense td { padding: 0.5mm 1.2mm; }
 .dense .prodhead img { height: 16mm; }
 .warn { border: 1px solid #b00; background: #fff3f3; padding: 3mm; margin: 4mm 0; }
 .warn h3 { margin: 0 0 1mm; font-size: 10pt; color: #b00; }
 .big { font-size: 11pt; }
 .soustitre { font-size: 10pt; color: #444; margin: -1mm 0 3mm; }
 th.retour, td.retour { border-left: 2px solid #444; }
 /* Colonnes du retour, imprimees vides a l'aller pour etre remplies a la main. */
 td.tofill { background: #fafafa; }
 td.tailles { font-size: 7.5pt; color: #333; line-height: 1.25; }
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
  /**
   * Une ligne est incomplete si une donnee lui manque VRAIMENT, recalcule a
   * chaque rendu. Le drapeau `incomplete` fige a la creation de l'instantane
   * devenait faux des qu'on corrigeait une donnee : il affichait encore
   * 54 lignes en defaut alors que plus rien ne manquait.
   */
  const estIncomplete = (it: PassageItem) =>
    !it.weight_grams || it.unit_cost_textile === null || !it.unit_price_eur;

  const packaging = passage.packaging_kg ?? {};
  const tariffs = passage.tariff_by_type ?? {};
  const shOf = (type: string) => tariffs[type]?.position ?? '';
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
  /**
   * Une ligne par TYPE Ivy. On ne fusionne jamais sur le libellé : un t-shirt
   * classique et un 240 g coton brossé peuvent porter le même mot courant, ce
   * sont deux articles distincts, de prix et de poids différents.
   */
  const byObjet = new Map<string, {
    qty: number; netG: number; chf: number; ret: number; types: string[];
  }>();
  for (const [type, t] of byType) {
    byObjet.set(type, { qty: t.qty, netG: t.netG, chf: t.chf, ret: t.ret, types: [type] });
  }
  const packagingOfObjet = (types: string[]) => types.reduce((n, t) => n + packagingOf(t), 0);

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
  html += `<div class="sheet">
<h1>${esc(passage.doc_titre) || titre}</h1>
${passage.doc_sous_titre ? `<p class="soustitre">${esc(passage.doc_sous_titre)}</p>` : ''}
<div class="meta">
 <b>Raison sociale</b> ${esc(passage.raison_sociale) || '—'}<br>
 <b>Nom et prénom</b> ${esc(passage.nom_prenom) || '—'}<br>
 <b>Siège social (France)</b> ${esc(passage.adresse_siege) || '—'}<br>
 <b>Lieu d'exposition</b> ${esc(passage.adresse_exposition) || '—'}<br>
 <b>Dates d'exposition</b> ${esc(passage.date_exposition) || '—'}<br>
 <b>Emplacement de départ</b> ${esc(passage.location_name)}<br>
 <b>Date d'entrée sur le territoire</b> ${esc(passage.departed_on)}<br>
 <b>Date de retour prévue</b> ${esc(passage.date_retour_prevue) || '—'}<br>
 ${passage.date_apurement ? `<b>Date d'apurement</b> ${esc(passage.date_apurement)}<br>` : ''}
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

<h2>Détail par type de produit</h2>
<table><thead>
<tr><th colspan="11">Départ</th><th colspan="7" class="retour">Retour</th></tr>
<tr>
 <th class="l">Objet</th><th class="l">Code SH</th><th class="l">Type Ivy</th><th>Quantité</th><th>Poids net (kg)</th><th>Caisses (kg)</th><th>Poids brut (kg)</th>
 <th>Valeur douanière au départ<br>HT (EUR)</th><th>Valeur douanière au départ<br>HT (CHF)</th><th>TVA import CHF</th>
 <th>Prix de vente unitaire<br>CHF TTC</th>
 ${closed
    ? '<th class="retour">Qté restante</th><th>Qté vendue</th><th>Poids restant (kg)</th>' +
      '<th>Valeur restante en douane (CHF)</th><th>CA vendu TTC (CHF)</th><th>Base imposable HT (CHF)</th><th>TVA due (CHF)</th>'
    : '<th class="tofill retour">Qté restante</th><th class="tofill">Qté vendue</th><th class="tofill">Poids restant (kg)</th>' +
      '<th class="tofill">Valeur restante en douane (CHF)</th><th class="tofill">CA vendu TTC (CHF)</th><th class="tofill">Base imposable HT (CHF)</th><th class="tofill">TVA due (CHF)</th>'}
</tr></thead><tbody>`;

  for (const [objet, o] of [...byObjet.entries()].sort((a, b) => b[1].qty - a[1].qty)) {
    const pack = packagingOfObjet(o.types);
    const brut = hasPackaging ? o.netG / 1000 + pack : null;
    const reste = o.ret;
    const vendu = Math.max(0, o.qty - o.ret);
    const unitG = o.qty > 0 ? o.netG / o.qty : 0;
    const unitHt = o.qty > 0 ? o.chf / o.qty : 0;
    // Prix de vente pratique en Suisse pour ce type. A defaut, le prix Ivy converti.
    const prixVenteTtc = (() => {
      const saisi = prices[objet];
      if (saisi && saisi > 0) return saisi;
      const lignes = items.filter(i => (i.product_type ?? '(sans type)') === objet);
      const q = lignes.reduce((n, i) => n + i.qty_departed, 0);
      const somme = lignes.reduce((n, i) => n + (Number(i.unit_price_eur) || 0) * i.qty_departed, 0);
      return q > 0 ? (somme / q) * rate : 0;
    })();
    html += `<tr><td class="l"><b>${esc(labelOf(objet))}</b></td>` +
      `<td class="l">${shOf(objet) || '<b style="color:#b00">—</b>'}</td>` +
      `<td class="l">${esc(objet)}</td><td>${o.qty}</td><td>${kg(o.netG)}</td>` +
      `<td>${hasPackaging ? kgv(pack) : '—'}</td>` +
      `<td>${brut !== null ? kgv(brut) : '—'}</td>` +
      `<td>${num(o.chf / rate)}</td><td>${num(o.chf)}</td><td>${num(vatOnImport(o.chf))}</td>` +
      `<td>${prixVenteTtc > 0 ? num(prixVenteTtc) : '<b style="color:#b00">—</b>'}</td>` +
      (closed
        ? (() => {
            // Au retour, la TVA suisse porte sur la CONTRE-PRESTATION encaissee,
            // pas sur le prix d'achat : base = CA TTC / (1 + TVA).
            const caTtc = prixVenteTtc * vendu;
            const base = caTtc / vatDiv;
            return `<td class="retour">${reste}</td><td>${vendu}</td>` +
              `<td>${kg(unitG * reste)}</td>` +
              `<td>${num(unitHt * reste)}</td>` +
              `<td>${num(caTtc)}</td><td>${num(base)}</td><td>${num(caTtc - base)}</td>`;
          })()
        : `<td class="tofill retour"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td>`) +
      `</tr>`;
  }

  html += `</tbody><tfoot><tr><td class="l" colspan="3">TOTAL</td><td>${pieces}</td><td>${kg(netG)}</td>` +
    `<td>${hasPackaging ? kgv(totalPackaging) : '—'}</td>` +
    `<td>${grossKg !== null ? kgv(grossKg) : '—'}</td>` +
    `<td>${num(customsChf / rate)}</td><td>${num(customsChf)}</td><td>${num(vatOnImport(customsChf))}</td><td></td>` +
    (closed
      ? (() => {
          const venduTotal = Math.max(0, pieces - returned);
          const unitG = pieces > 0 ? netG / pieces : 0;
          const unitHt = pieces > 0 ? customsChf / pieces : 0;
          let caTtc = 0;
          for (const [type, t] of byType) {
            const p = prices[type] ?? 0;
            caTtc += p * Math.max(0, t.qty - t.ret);
          }
          const base = caTtc / vatDiv;
          return `<td class="retour">${returned}</td><td>${venduTotal}</td>` +
            `<td>${kg(unitG * returned)}</td>` +
            `<td>${num(unitHt * returned)}</td>` +
            `<td>${num(caTtc)}</td><td>${num(base)}</td><td>${num(caTtc - base)}</td>`;
        })()
      : `<td class="tofill retour"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td>`) +
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

  // ---------- Une annexe par objet declare ----------
  // Six feuilles au lieu de cinquante-quatre. Chacune rappelle le total du type
  // puis detaille ses modeles, avec leur photo : c'est ce qui permet a un
  // douanier de verifier un carton sans qu'on l'y invite.
  const parObjet = new Map<string, Map<string, {
    titre: string; image: string | null; qty: number; netG: number; chf: number;
    /** Repartition par taille : permet de verifier un carton sans l'ouvrir en entier. */
    tailles: Map<string, number>;
  }>>();
  for (const it of items) {
    const type = it.product_type ?? '(sans type)';
    if (!parObjet.has(type)) parObjet.set(type, new Map());
    const m = parObjet.get(type)!;
    const r = m.get(it.product_title) ?? {
      titre: it.product_title, image: it.image_url, qty: 0, netG: 0, chf: 0,
      tailles: new Map<string, number>(),
    };
    r.qty += it.qty_departed;
    r.netG += (it.weight_grams ?? 0) * it.qty_departed;
    r.chf += customsChfOf(it) * it.qty_departed;
    if (!r.image && it.image_url) r.image = it.image_url;
    const taille = (it.size ?? '').trim() || '—';
    r.tailles.set(taille, (r.tailles.get(taille) ?? 0) + it.qty_departed);
    m.set(it.product_title, r);
  }

  for (const [objet, modeles] of [...parObjet.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const lignes = [...modeles.values()].sort((a, b) => b.qty - a.qty);
    const t = byObjet.get(objet)!;
    const brut = hasPackaging ? t.netG / 1000 + packagingOfObjet(t.types) : null;

    html += `<div class="sheet${lignes.length > 22 ? ' dense' : ''}">
<h1>Annexe — ${esc(labelOf(objet))}</h1>
<div class="meta">
 <b>Objet déclaré</b> ${esc(labelOf(objet))}<br>
 <b>Type Ivy</b> ${esc(objet)}<br>
 <b>Code SH</b> ${esc(shOf(objet)) || "—"}<br>
 <b>Quantité totale</b> ${t.qty} pièce(s)<br>
 <b>Poids net / brut</b> ${kg(t.netG)} kg / ${brut !== null ? kgv(brut) : '—'} kg<br>
 <b>Valeur en douane</b> ${num(t.chf / rate)} EUR &nbsp;/&nbsp; ${num(t.chf)} CHF<br>
 <b>Origine</b> ${esc(passage.origin)} &nbsp;·&nbsp;
 <b style="min-width:auto">Emplacement</b> ${esc(passage.location_name)} &nbsp;·&nbsp; ${esc(passage.departed_on)}
</div>
<table><thead><tr>
 <th class="l">Photo</th><th class="l">Modèle</th><th>Quantité</th>
 <th class="l">Répartition par taille</th><th>Poids net (kg)</th>
 <th>Valeur HT (EUR)</th><th>Valeur HT (CHF)</th>
</tr></thead><tbody>${lignes.map(l => `<tr>
 <td class="l">${l.image ? `<img src="${esc(l.image)}" alt="">` : ''}</td>
 <td class="l">${esc(l.titre)}</td>
 <td>${l.qty}</td>
 <td class="l tailles">${[...l.tailles.entries()]
   .sort((a, b) => sizeRank(a[0]) - sizeRank(b[0]) || a[0].localeCompare(b[0]))
   .map(([t, n]) => `${esc(t)}&nbsp;${n}`).join(' · ')}</td>
 <td>${kg(l.netG)}</td>
 <td>${num(l.chf / rate)}</td><td>${num(l.chf)}</td>
</tr>`).join('')}</tbody>
<tfoot><tr>
 <td class="l" colspan="2">TOTAL — ${esc(labelOf(objet))}</td>
 <td>${t.qty}</td><td></td><td>${kg(t.netG)}</td>
 <td>${num(t.chf / rate)}</td><td>${num(t.chf)}</td>
</tr></tfoot></table></div>`;
  }

  return html + `</body></html>`;
}
