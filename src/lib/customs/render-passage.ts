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
 @page { size: A4 landscape; margin: 7mm; }
 body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 8pt; color: #1a1a1a; }
 h1 { font-size: 12.5pt; margin: 0 0 1.5mm; }
 h2 { font-size: 10pt; margin: 2mm 0 1mm; }
 .sheet { page-break-after: always; }
 .sheet:last-child { page-break-after: auto; }
 .meta { margin-bottom: 4mm; }
 .meta b { display: inline-block; min-width: 46mm; }
 /* Le tableau doit pouvoir COMMENCER sur la page en cours et se poursuivre :
    avec page-break-inside:avoid il partait en bloc a la page suivante, laissant
    un grand vide. On empeche seulement la coupure au milieu d'une ligne. */
 table { border-collapse: collapse; width: 100%; page-break-inside: auto; }
 tr { page-break-inside: avoid; page-break-after: auto; }
 thead { display: table-header-group; }
 tfoot { display: table-row-group; }
 th, td { border: 1px solid #999; padding: 0.7mm 1.1mm; text-align: right; }
 th { background: #eee; text-align: center; font-size: 7pt; line-height: 1.15; }
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
 .soustitre { font-size: 8.5pt; color: #222; margin: -0.5mm 0 2mm; }
 /* En-tete en pastilles : treize lignes empilees poussaient le tableau sur
    une seconde page. Sur une ou deux lignes, tout tient. */
 .chips { display: flex; flex-wrap: wrap; gap: 1mm; margin-bottom: 1.8mm; }
 .chip { border: 1px solid #c4c4c4; border-radius: 1.5mm; padding: 0.5mm 1.6mm;
         font-size: 6.8pt; background: #fbfbfb; white-space: nowrap; }
 /* Les libelles etaient en gris clair : une imprimante jet d'encre les rendait
    illisibles a 6,8 pt. On les distingue par la casse et la graisse, pas par la
    couleur — le gris ne survit pas a l'impression. */
 .chip b { color: #111; font-weight: 700; margin-right: 1.2mm;
           text-transform: uppercase; letter-spacing: 0.02em; font-size: 6pt; }
 .totaux .chip { font-size: 8pt; padding: 0.8mm 2mm; background: #f0f0ea;
                 border-color: #999; }
 .totaux .chip b { color: #000; font-size: 6.6pt; }
 th.retour, td.retour { border-left: 2px solid #444; }
 /* Colonnes du retour, imprimees vides a l'aller pour etre remplies a la main. */
 td.tofill { background: #fafafa; }
 td.tailles { font-size: 7.5pt; color: #111; line-height: 1.25; }
 th.tofill { color: #222; font-style: italic; }
 /* Ces colonnes se remplissent a la cloture, par comparaison des deux instantanes. */
 .noprint { margin: 0 0 5mm; padding: 3mm; background: #eef4ee; border: 1px solid #9ab; }
 @media print {
   .noprint { display: none; }
   /* Rien ne doit dependre d'un gris : sur papier, il disparait. */
   .chip b, .totaux .chip b { color: #000; }
   * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
 }
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
  let returned = 0, sold = 0;
  /**
   * Poids et valeur de ce qui revient VRAIMENT, cumules ligne a ligne.
   *
   * Le total se calculait en multipliant la moyenne du DEPART par le nombre de
   * pieces revenues. Faux des que la composition du retour differe de celle du
   * depart : ce sont les articles legers et bon marche qui se vendent le mieux,
   * donc ce qui repart pese et vaut plus cher a la piece que la moyenne du lot.
   */
  let netRetG = 0, chfRet = 0;
  /**
   * Les lignes en ecart, avec leur SENS. Un ecart positif et un ecart negatif
   * n'ont pas la meme cause : servir les deux explications a chaque fois oblige
   * le douanier a deviner laquelle s'applique.
   */
  const ecartLignes: { titre: string; taille: string | null; couleur: string | null; delta: number }[] = [];
  const byType = new Map<string, {
    qty: number; netG: number; chf: number; ret: number; sold: number;
    /** Poids et valeur effectivement revenus, cumules ligne a ligne. */
    netRetG: number; chfRet: number;
  }>();
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
      netRetG += g * (it.qty_returned ?? 0);
      chfRet += customsChfOf(it) * (it.qty_returned ?? 0);
      const delta = it.qty_departed - (it.qty_returned ?? 0) - (it.qty_sold_recorded ?? 0);
      if (delta !== 0) {
        ecartLignes.push({ titre: it.product_title, taille: it.size, couleur: it.color, delta });
      }
    }
    if (!it.weight_grams) problems.noWeight++;
    if (it.unit_cost_textile === null) problems.noRule++;
    if (!it.unit_price_eur) problems.noPrice++;

    const t = it.product_type ?? '(sans type)';
    const agg = byType.get(t) ?? { qty: 0, netG: 0, chf: 0, ret: 0, sold: 0, netRetG: 0, chfRet: 0 };
    agg.qty += it.qty_departed;
    agg.netG += g * it.qty_departed;
    agg.chf += customsChfOf(it) * it.qty_departed;
    agg.ret += it.qty_returned ?? 0;
    agg.sold += it.qty_sold_recorded ?? 0;
    agg.netRetG += g * (it.qty_returned ?? 0);
    agg.chfRet += customsChfOf(it) * (it.qty_returned ?? 0);
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
   * Poids brut au retour. Les caisses reviennent ENTIERES — elles ne se vendent
   * pas — donc leur poids s'ajoute tel quel au net restant, sans prorata.
   * C'est ce chiffre que reclame la declaration de reexportation.
   */
  const grossRetKg = !closed
    ? null
    : hasPackaging
      ? netRetG / 1000 + totalPackaging
      : grossRatio !== null ? (netRetG / 1000) * grossRatio : null;
  /**
   * Une ligne par TYPE Ivy. On ne fusionne jamais sur le libellé : un t-shirt
   * classique et un 240 g coton brossé peuvent porter le même mot courant, ce
   * sont deux articles distincts, de prix et de poids différents.
   */
  const byObjet = new Map<string, {
    qty: number; netG: number; chf: number; ret: number; types: string[];
    netRetG: number; chfRet: number;
  }>();
  for (const [type, t] of byType) {
    byObjet.set(type, {
      qty: t.qty, netG: t.netG, chf: t.chf, ret: t.ret, types: [type],
      netRetG: t.netRetG, chfRet: t.chfRet,
    });
  }
  const packagingOfObjet = (types: string[]) => types.reduce((n, t) => n + packagingOf(t), 0);

  const grossOfType = (type: string, typeNetG: number) =>
    hasPackaging
      ? typeNetG / 1000 + packagingOf(type)
      : grossRatio !== null ? (typeNetG / 1000) * grossRatio : null;
  const titre = closed
    ? 'Réexportation après vente incertaine — formulaire 11.74'
    : 'Importation temporaire pour vente incertaine — formulaire 1187';

  /**
   * Apurement. Ce qui n'est pas réexporté reste en Suisse : la TVA due porte sur
   * la CONTRE-PRESTATION encaissée, jamais sur la valeur d'entrée. Calculé une
   * seule fois — les pastilles du haut, le total du tableau et le paragraphe de
   * conclusion doivent annoncer le même montant, sinon le document se contredit
   * lui-même sous les yeux du douanier.
   */
  const venduTotal = Math.max(0, pieces - returned);
  let caTtcTotal = 0;
  for (const [type, t] of byType) {
    caTtcTotal += (prices[type] ?? 0) * Math.max(0, t.qty - t.ret);
  }
  const baseTotale = caTtcTotal / vatDiv;
  const tvaDue = caTtcTotal - baseTotale;

  let html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>${esc(passage.doc_titre) || 'Douane suisse'} — ${esc(passage.departed_on)}</title>
<style>${CSS}</style></head><body>
<div class="noprint"><b>Ctrl+P</b> puis « Enregistrer en PDF », orientation <b>paysage</b>.
Coche « Graphiques d'arrière-plan » pour que les lignes signalées restent visibles. Ce bandeau ne s'imprime pas.</div>`;

  // ---------- Feuille de résumé ----------
  html += `<div class="sheet">
<h1>${esc(passage.doc_titre) || titre}</h1>
${passage.doc_sous_titre ? `<p class="soustitre">${esc(passage.doc_sous_titre)}</p>` : ''}
<div class="chips">
 ${[
   ['Raison sociale', esc(passage.raison_sociale)],
   ['Nom et prénom', esc(passage.nom_prenom)],
   ['Siège social (France)', esc(passage.adresse_siege)],
   ["Lieu d'exposition", esc(passage.adresse_exposition)],
   ["Dates d'exposition", esc(passage.date_exposition)],
   ["Entrée sur le territoire", esc(passage.departed_on)],
   ['Retour prévu', esc(passage.date_retour_prevue)],
   ...(passage.date_apurement ? [["Apurement", esc(passage.date_apurement)]] : []),
   ...(closed ? [['Retour effectif', esc(passage.returned_on)]] : []),
   ['Référence 1187', esc(passage.reference)],
   ['Taux', `1 EUR = ${rate} CHF`],
   ['TVA suisse', `${passage.vat_pct} %`],
   ['Origine', esc(passage.origin)],
 ].filter(([, v]) => v).map(([k, v]) => `<span class="chip"><b>${k}</b> ${v}</span>`).join('')}
</div>

<div class="chips totaux">
 <span class="chip fort"><b>Pièces déclarées</b> ${pieces}</span>
 <span class="chip fort"><b>Poids net</b> ${kgv(netG / 1000)} kg</span>
 <span class="chip fort"><b>Poids brut</b> ${grossKg !== null ? kgv(grossKg) + ' kg' : '— à compléter'}</span>
 <span class="chip fort"><b>Valeur en douane</b> ${num(customsChf / rate)} EUR &nbsp;/&nbsp; ${num(customsChf)} CHF</span>
 <span class="chip fort"><b>TVA à l'import</b> ${num(vatOnImport(customsChf))} CHF</span>
 ${closed
   ? `<span class="chip fort"><b>Revenues</b> ${returned}</span>` +
     `<span class="chip fort"><b>Poids net au retour</b> ${kg(netRetG)} kg</span>` +
     (grossRetKg !== null ? `<span class="chip fort"><b>Poids brut au retour</b> ${kgv(grossRetKg)} kg</span>` : '') +
     `<span class="chip fort"><b>Vendues (caisse)</b> ${sold}</span>` +
     `<span class="chip fort"><b>CA encaissé</b> ${num(caTtcTotal)} CHF</span>` +
     `<span class="chip fort"><b>Base imposable</b> ${num(baseTotale)} CHF</span>` +
     `<span class="chip fort"><b>TVA due</b> ${num(tvaDue)} CHF</span>`
   : ''}
</div>
<p style="font-size:6.8pt;color:#333;margin:0 0 2mm">
 <b>Valeur en douane = prix d'achat</b> (coût du textile + coût de l'impression), hors taxe par nature.
 Conversion en francs au taux de ${rate}.
 ${closed
   ? `Les prix de vente ci-dessous sont des <b>moyennes pondérées par type, remises comprises</b> :
      la contre-prestation réellement encaissée, ramenée à l'unité. Ils n'entrent pas dans la valeur
      en douane — qui reste le prix d'achat — mais ce sont eux qui déterminent la base imposable et
      la TVA due à l'apurement.`
   : `Les prix de vente ci-dessous ne servent qu'à situer la marchandise ;
      ils n'entrent pas dans la valeur déclarée.`}
</p>

<h2>Détail par type de produit</h2>
<table><thead>
<tr><th colspan="${closed ? 10 : 11}">Départ</th><th colspan="${closed ? 8 : 7}" class="retour">Retour</th></tr>
<tr>
 <th class="l">Objet</th><th class="l">Code SH</th><th class="l">Type Ivy</th><th>Quantité</th><th>Poids net (kg)</th><th>Caisses (kg)</th><th>Poids brut (kg)</th>
 <th>Valeur douanière au départ<br>HT (EUR)</th><th>Valeur douanière au départ<br>HT (CHF)</th><th>TVA import CHF</th>
 ${closed
    // Une fois cloture, le prix pratique n'est plus une indication de depart :
    // c'est la contre-prestation encaissee, donc une donnee de RETOUR. Il se lit
    // juste avant le CA qu'il produit — quantite vendue x prix = CA.
    ? '<th class="retour">Qté restante</th><th>Qté vendue</th><th>Poids restant (kg)</th>' +
      '<th>Valeur restante en douane (CHF)</th>' +
      '<th>Prix de vente moyen<br>pondéré CHF TTC</th>' +
      '<th>CA vendu TTC (CHF)</th><th>Base imposable HT (CHF)</th><th>TVA due (CHF)</th>'
    : '<th>Prix de vente unitaire<br>CHF TTC</th>' +
      '<th class="tofill retour">Qté restante</th><th class="tofill">Qté vendue</th><th class="tofill">Poids restant (kg)</th>' +
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
      (closed
        ? (() => {
            // Au retour, la TVA suisse porte sur la CONTRE-PRESTATION encaissee,
            // pas sur le prix d'achat : base = CA TTC / (1 + TVA).
            const caTtc = prixVenteTtc * vendu;
            const base = caTtc / vatDiv;
            return `<td class="retour">${reste}</td><td>${vendu}</td>` +
              `<td>${kg(o.netRetG)}</td>` +
              `<td>${num(o.chfRet)}</td>` +
              `<td>${prixVenteTtc > 0 ? num(prixVenteTtc) : '<b style="color:#b00">—</b>'}</td>` +
              `<td>${num(caTtc)}</td><td>${num(base)}</td><td>${num(caTtc - base)}</td>`;
          })()
        : `<td>${prixVenteTtc > 0 ? num(prixVenteTtc) : '<b style="color:#b00">—</b>'}</td>` +
          `<td class="tofill retour"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td>`) +
      `</tr>`;
  }

  html += `</tbody><tfoot><tr><td class="l" colspan="3">TOTAL</td><td>${pieces}</td><td>${kg(netG)}</td>` +
    `<td>${hasPackaging ? kgv(totalPackaging) : '—'}</td>` +
    `<td>${grossKg !== null ? kgv(grossKg) : '—'}</td>` +
    `<td>${num(customsChf / rate)}</td><td>${num(customsChf)}</td><td>${num(vatOnImport(customsChf))}</td>` +
    (closed
      ? (() => {
          // Prix moyen toutes lignes confondues : le CA rapporte aux pieces
          // vendues. C'est la moyenne que le douanier refera de tete.
          const prixMoyen = venduTotal > 0 ? caTtcTotal / venduTotal : 0;
          return `<td class="retour">${returned}</td><td>${venduTotal}</td>` +
            `<td>${kg(netRetG)}</td>` +
            `<td>${num(chfRet)}</td>` +
            `<td>${num(prixMoyen)}</td>` +
            `<td>${num(caTtcTotal)}</td><td>${num(baseTotale)}</td><td>${num(tvaDue)}</td>`;
        })()
      : `<td></td><td class="tofill retour"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td><td class="tofill"></td>`) +
    `</tr></tfoot></table>`;

  if (!closed) {
    html += `<p style="font-size:7.5pt;color:#333;margin-top:2mm">
     Les sept colonnes de droite se remplissent automatiquement à la clôture du passage,
     en comparant l'instantané de départ au stock constaté au retour. Rien n'est à saisir à la main.
     Le poids brut par type est réparti au prorata du poids net.</p>`;
  } else if (closed) {
    html += `<p style="font-size:7.5pt;color:#333;margin-top:2mm">
     <b>TVA réellement due</b> : elle porte sur la contre-prestation encaissée en Suisse,
     soit <b>${venduTotal}</b> pièce(s) vendues pour <b>${num(caTtcTotal)} CHF TTC</b>,
     dont <b>${num(baseTotale)} CHF</b> de base imposable et <b>${num(tvaDue)} CHF</b> de TVA —
     à opposer aux ${num(vatOnImport(customsChf))} CHF avancés à l'entrée.
     « Vendu » vaut ici « parti − revenu », ce qui a réellement quitté le stock ; le relevé de caisse,
     lui, totalise ${sold} pièce(s).</p>`;
  }
  if (closed && ecartLignes.length > 0) {
    // On n'explique que le sens observe. Servir les deux causes a chaque fois
    // obligeait le douanier a deviner laquelle s'appliquait a la ligne devant lui.
    const manquantes = ecartLignes.filter(e => e.delta > 0);
    const surnumeraires = ecartLignes.filter(e => e.delta < 0);
    const nommer = (e: typeof ecartLignes[number]) =>
      `<li><b>${esc(e.titre)}</b>${e.taille ? ` / ${esc(e.taille)}` : ''}${e.couleur ? ` / ${esc(e.couleur)}` : ''} — ` +
      `${Math.abs(e.delta)} pièce(s) manquante(s)</li>`;

    // Une piece MANQUANTE appelle une justification : elle a quitte le stock sans
    // passer en caisse. Une piece EN PLUS n'est pas une anomalie douaniere — elle
    // est declaree et elle ressort du territoire. L'encadre d'alerte, qui attire
    // l'oeil et appelle la question, ne sert donc que pour le premier cas.
    if (manquantes.length > 0) {
      html += `<div class="warn"><h3>${manquantes.length} ligne(s) avec un manque</h3>
       <p style="margin:0 0 1mm">Sur ces lignes, « parti − revenu » dépasse les ventes enregistrées à la
       caisse : casse, cadeau, ou pièce partie sans passer en caisse.</p>
       <ul style="margin:0;padding-left:4mm">${manquantes
         .sort((a, b) => b.delta - a.delta).slice(0, 12).map(nommer).join('')}</ul>
       ${manquantes.length > 12 ? `<p style="margin:1mm 0 0">… et ${manquantes.length - 12} autre(s).</p>` : ''}</div>`;
    }

    if (surnumeraires.length > 0) {
      const n = surnumeraires.reduce((s, e) => s + Math.abs(e.delta), 0);
      html += `<p style="font-size:7.5pt;color:#333;margin-top:2mm">
       L'instantané de retour comprend <b>${n} pièce(s)</b> rapportée(s) par un client pendant l'exposition,
       donc absente(s) de l'instantané de départ. Elle(s) sont déclarée(s) au retour et comptée(s) dans les
       ${returned} pièces réexportées.</p>`;
    }
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
 <b>Origine</b> ${esc(passage.origin)} &nbsp;·&nbsp; ${esc(passage.departed_on)}
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
