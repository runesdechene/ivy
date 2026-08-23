import {
  computeValuation,
  controlesBloquants,
  arrondiDeclare,
  type MethodeRepartition,
  type RegimeValeur,
  type TariffInfo,
} from './valuation';

/**
 * L1 — Facture proforma d'importation, en admission temporaire pour vente
 * incertaine (OFDF Publ. 52.03).
 *
 * Par article : caractéristiques d'identification, quantité, valeur unitaire et
 * totale en CHF. Mention obligatoire du lieu de vente prévu. Bloc récapitulatif
 * par position tarifaire, avec le poids total — les droits de douane suisses se
 * calculent au poids.
 *
 * La valeur déclarée est le **prix d'achat** (R1), jamais le prix de vente.
 */

export interface ProformaPassage {
  location_name: string;
  reference: string | null;
  numero_decision: string | null;
  bureau_douane: string | null;
  lieu_vente: string | null;
  departed_on: string;
  date_expiration: string | null;
  eur_to_chf: number;
  frais_transport_chf: number;
  methode_repartition: string;
  regime_valeur: string;
  surete_deposee_chf: number | null;
  origin: string;
  customs_labels?: Record<string, string>;
  tariff_by_type?: Record<string, TariffInfo>;
}

export interface ProformaItem {
  product_title: string;
  product_type: string | null;
  size: string | null;
  color: string | null;
  qty_departed: number;
  weight_grams: number | null;
  unit_cost_textile: number | null;
  unit_cost_print: number | null;
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

const CSS = `
 @page { size: A4 portrait; margin: 12mm; }
 body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 9pt; color: #111; }
 h1 { font-size: 14pt; margin: 0 0 1mm; }
 h2 { font-size: 11pt; margin: 5mm 0 1.5mm; }
 .sub { color: #555; margin-bottom: 4mm; }
 .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1mm 6mm; margin-bottom: 4mm; }
 .grid b { display: inline-block; min-width: 46mm; }
 table { border-collapse: collapse; width: 100%; margin-bottom: 3mm; }
 th, td { border: 1px solid #888; padding: 1.2mm 1.6mm; text-align: right; font-size: 8.5pt; }
 th { background: #eee; text-align: center; }
 td.l, th.l { text-align: left; }
 tfoot td { font-weight: bold; background: #f4f4f4; }
 .warn { border: 2px solid #b00; background: #fff3f3; padding: 3mm; margin: 4mm 0; }
 .warn h3 { margin: 0 0 1mm; font-size: 10pt; color: #b00; }
 .formula { font-size: 7.5pt; color: #555; margin: 0 0 4mm; }
 .exemplaire { page-break-after: always; }
 .exemplaire:last-child { page-break-after: auto; }
 .sig { margin-top: 8mm; display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
 .sig div { border-top: 1px solid #888; padding-top: 1.5mm; font-size: 8pt; color: #555; }
 .noprint { margin-bottom: 4mm; padding: 3mm; background: #eef4ee; border: 1px solid #9ab; }
 @media print { .noprint { display: none; } }
`;

export function renderProforma(passage: ProformaPassage, items: ProformaItem[]): string {
  const rate = Number(passage.eur_to_chf);
  const tariffs = passage.tariff_by_type ?? {};
  const labels = passage.customs_labels ?? {};
  const labelOf = (t: string) => labels[t] || t;
  const num = (n: number) => arrondiDeclare(n).toFixed(2);

  // Une ligne d'article = un type de produit (c'est la maille que la douane lit).
  const byType = new Map<string, { qty: number; poidsG: number; coutEur: number }>();
  for (const it of items) {
    const t = it.product_type ?? '(sans type)';
    const agg = byType.get(t) ?? { qty: 0, poidsG: 0, coutEur: 0 };
    const cout = (Number(it.unit_cost_textile) || 0) + (Number(it.unit_cost_print) || 0);
    agg.qty += it.qty_departed;
    agg.poidsG += (it.weight_grams ?? 0) * it.qty_departed;
    agg.coutEur += cout * it.qty_departed;
    byType.set(t, agg);
  }

  const types = [...byType.keys()];
  const valuation = computeValuation(
    types.map(t => {
      const a = byType.get(t)!;
      return {
        coutUnitaireEur: a.qty > 0 ? a.coutEur / a.qty : 0,
        quantite: a.qty,
        poidsUnitaireG: a.qty > 0 ? a.poidsG / a.qty : 0,
      };
    }),
    {
      tauxChange: rate,
      fraisTransportChf: Number(passage.frais_transport_chf) || 0,
      methode: (passage.methode_repartition as MethodeRepartition) || 'VALEUR',
      regime: (passage.regime_valeur as RegimeValeur) || 'NEGOCE',
    },
  );

  const controles = controlesBloquants({
    tauxChange: rate,
    types,
    tariffByType: tariffs,
    dateExpiration: passage.date_expiration,
  });

  const rows = types.map((t, i) => ({
    type: t,
    label: labelOf(t),
    ...byType.get(t)!,
    ...valuation[i],
    tariff: tariffs[t] ?? {},
  }));

  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalPoidsG = rows.reduce((s, r) => s + r.poidsG, 0);
  const totalValeur = rows.reduce((s, r) => s + r.valeurLigneChf, 0);

  // Récapitulatif par position tarifaire : les droits se calculent au poids.
  const byPosition = new Map<string, { qty: number; poidsG: number; valeur: number; tva: number; libelles: Set<string> }>();
  for (const r of rows) {
    const key = r.tariff.position || '— non renseignée —';
    const agg = byPosition.get(key) ?? { qty: 0, poidsG: 0, valeur: 0, tva: r.tariff.tva ?? 8.1, libelles: new Set<string>() };
    agg.qty += r.qty;
    agg.poidsG += r.poidsG;
    agg.valeur += r.valeurLigneChf;
    agg.libelles.add(r.label);
    byPosition.set(key, agg);
  }

  const bloquants = controles.filter(c => c.code === 'A4' || c.code === 'A6' || c.code === 'A2');

  const corps = (exemplaire: string) => `
<div class="exemplaire">
<h1>Facture proforma — admission temporaire pour vente incertaine</h1>
<div class="sub">
 Exemplaire ${exemplaire} sur 3 · Régime : admission temporaire (OFDF Publ. 52.03, LD art. 9 / 58)
</div>

<div class="grid">
 <div><b>Lieu de vente prévu</b> ${esc(passage.lieu_vente) || '<span style="color:#b00">à renseigner</span>'}</div>
 <div><b>Date de déclaration</b> ${esc(passage.departed_on)}</div>
 <div><b>Bureau de douane</b> ${esc(passage.bureau_douane) || '—'}</div>
 <div><b>Délai d'apurement</b> ${esc(passage.date_expiration) || '—'}</div>
 <div><b>N° de décision (11.78)</b> ${esc(passage.numero_decision) || '—'}</div>
 <div><b>Référence interne</b> ${esc(passage.reference) || '—'}</div>
 <div><b>Taux de change figé</b> 1 EUR = ${rate} CHF</div>
 <div><b>Sûreté déposée</b> ${passage.surete_deposee_chf !== null ? num(Number(passage.surete_deposee_chf)) + ' CHF' : '—'}</div>
 <div><b>Régime de valeur</b> ${esc(passage.regime_valeur)}</div>
 <div><b>Frais de transport</b> ${num(Number(passage.frais_transport_chf) || 0)} CHF, répartis par ${esc(passage.methode_repartition)}</div>
 <div><b>Emplacement d'origine</b> ${esc(passage.location_name)}</div>
 <div><b>Pièces déclarées</b> ${totalQty}</div>
</div>

${bloquants.length > 0 ? `<div class="warn"><h3>Document non conforme — ${bloquants.length} contrôle(s) bloquant(s)</h3><ul>${
  bloquants.map(c => `<li><b>${c.code}</b> — ${esc(c.message)}${c.detail ? ` (${esc(c.detail.join(', '))})` : ''}</li>`).join('')
}</ul><p style="margin:2mm 0 0">Ne pas présenter en l'état : la douane refusera le classement.</p></div>` : ''}

<h2>Articles déclarés</h2>
<table><thead><tr>
 <th class="l">Désignation</th><th class="l">Position tarifaire</th><th class="l">Origine</th>
 <th>Quantité</th><th>Poids net (kg)</th>
 <th>Valeur unit. (CHF)</th><th>Valeur totale (CHF)</th>
</tr></thead><tbody>${rows.map(r => `<tr>
 <td class="l">${esc(r.label)}</td>
 <td class="l">${r.tariff.position ? esc(r.tariff.position) : '<b style="color:#b00">manquante</b>'}</td>
 <td class="l">${r.tariff.origine ? esc(r.tariff.origine) : '<b style="color:#b00">manquante</b>'}</td>
 <td>${r.qty}</td>
 <td>${(r.poidsG / 1000).toFixed(3)}</td>
 <td>${num(r.valeurUnitaireChf)}</td>
 <td>${num(r.valeurLigneChf)}</td>
</tr>`).join('')}</tbody>
<tfoot><tr>
 <td class="l" colspan="3">TOTAL</td><td>${totalQty}</td><td>${(totalPoidsG / 1000).toFixed(3)}</td>
 <td></td><td>${num(totalValeur)}</td>
</tr></tfoot></table>

<p class="formula">
 <b>Valeur d'entrée</b> = ${passage.regime_valeur === 'NEGOCE'
   ? `prix d'achat HT (EUR) × ${rate}`
   : 'valeur marchande (CHF)'} + quote-part de transport,
 répartie au prorata ${passage.methode_repartition === 'POIDS' ? 'du poids' : 'de la valeur'}.
 Le prix de vente au public n'entre pas dans cette valeur.
</p>

<h2>Récapitulatif par position tarifaire</h2>
<table><thead><tr>
 <th class="l">Position tarifaire</th><th class="l">Marchandises</th>
 <th>Quantité</th><th>Poids total (kg)</th><th>Valeur (CHF)</th><th>TVA applicable</th>
</tr></thead><tbody>${[...byPosition.entries()].map(([pos, a]) => `<tr>
 <td class="l">${esc(pos)}</td>
 <td class="l">${esc([...a.libelles].join(', '))}</td>
 <td>${a.qty}</td><td>${(a.poidsG / 1000).toFixed(3)}</td>
 <td>${num(a.valeur)}</td><td>${a.tva} %</td>
</tr>`).join('')}</tbody>
<tfoot><tr>
 <td class="l" colspan="2">TOTAL</td><td>${totalQty}</td>
 <td>${(totalPoidsG / 1000).toFixed(3)}</td><td>${num(totalValeur)}</td><td></td>
</tr></tfoot></table>

<div class="sig">
 <div>Date et signature du déclarant</div>
 <div>Visa du bureau de douane</div>
</div>
</div>`;

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Proforma admission temporaire — ${esc(passage.location_name)} — ${esc(passage.departed_on)}</title>
<style>${CSS}</style></head><body>
<div class="noprint"><b>Ctrl+P</b> puis « Enregistrer en PDF », orientation <b>portrait</b>.
Trois exemplaires sont générés, comme l'exige le régime. Ce bandeau ne s'imprime pas.</div>
${corps('1')}${corps('2')}${corps('3')}
</body></html>`;
}
