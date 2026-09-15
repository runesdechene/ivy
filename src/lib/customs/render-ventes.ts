/**
 * Liste des ventes reconstituées d'un passage, imprimable.
 *
 * Une ligne par paiement : SumUp (mêmes date, heure et montant que le rapport
 * d'origine) ou espèces (reconstituées, sans autre trace). Chaque montant déclaré
 * est la somme de son panier, et le total celle des paiements : tout se recalcule.
 */

import { syntheseParType, type Reconstitution } from './reconstitution';

export interface PassageVentes {
  location_name: string;
  doc_titre?: string | null;
  departed_on: string;
  returned_on: string | null;
  date_exposition?: string | null;
  eur_to_chf: number;
  vat_pct: number;
  customs_labels?: Record<string, string> | null;
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const chf = (centimes: number) => (centimes / 100).toFixed(2);

const CSS = `
 @page { size: A4 portrait; margin: 9mm; }
 body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 8pt; color: #111; }
 h1 { font-size: 12.5pt; margin: 0 0 1.5mm; }
 h2 { font-size: 10pt; margin: 4mm 0 1.5mm; }
 .chips { display: flex; flex-wrap: wrap; gap: 1mm; margin-bottom: 2mm; }
 .chip { border: 1px solid #aaa; border-radius: 1.5mm; padding: 0.5mm 1.6mm; font-size: 7pt; white-space: nowrap; }
 .chip b { text-transform: uppercase; font-size: 6.2pt; margin-right: 1.2mm; }
 table { border-collapse: collapse; width: 100%; }
 tr { page-break-inside: avoid; }
 thead { display: table-header-group; }
 th, td { border: 1px solid #999; padding: 0.6mm 1.2mm; text-align: right; vertical-align: top; }
 th { background: #eee; text-align: center; font-size: 7pt; }
 td.l, th.l { text-align: left; }
 tr.especes td { background: #f6f3ea; }
 tfoot td { font-weight: bold; background: #f4f4f4; }
 .note { font-size: 7pt; color: #222; margin: 1.5mm 0; }
 .noprint { margin: 0 0 4mm; padding: 3mm; background: #eef4ee; border: 1px solid #9ab; }
 @media print { .noprint { display: none; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

/** 2026-08-27T18:07 → 27/08 18:07. */
const dateCourte = (iso: string | null) => {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]} ${m[4]}` : esc(iso);
};

export function renderVentes(passage: PassageVentes, r: Reconstitution): string {
  const labels = passage.customs_labels ?? {};
  const libelle = (type: string) => labels[type] || type;
  const synthese = syntheseParType(r, Number(passage.vat_pct));
  const sumup = r.paiements.filter((p) => p.source === 'sumup');
  const especes = r.paiements.filter((p) => p.source === 'especes');
  const totalDeclare = r.paiements.reduce((n, p) => n + p.declareCentimes, 0);
  const totalEur = Math.round(sumup.reduce((n, p) => n + p.montant * 100, 0));

  let html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Ventes — ${esc(passage.doc_titre || passage.location_name)}</title><style>${CSS}</style></head><body>
<div class="noprint"><b>Ctrl+P</b> puis « Enregistrer en PDF ». Ce bandeau ne s'imprime pas.</div>
<h1>Liste des ventes reconstituées — ${esc(passage.doc_titre || passage.location_name)}</h1>
<div class="chips">${[
    ["Dates d'exposition", esc(passage.date_exposition)],
    ['Entrée', esc(passage.departed_on)],
    ['Retour', esc(passage.returned_on)],
    ['Taux du passage', `1 EUR = ${passage.eur_to_chf} CHF`],
    ['Paiements SumUp', `${sumup.length} · ${chf(totalEur)} EUR`],
    ['Espèces', r.entrees.especesChf || r.entrees.especesEur
      ? `${r.entrees.especesChf.toFixed(2)} CHF + ${r.entrees.especesEur.toFixed(2)} EUR` : 'aucune'],
    ['CA déclaré', `${chf(totalDeclare)} CHF`],
  ].filter(([, v]) => v).map(([k, v]) => `<span class="chip"><b>${k}</b> ${v}</span>`).join('')}</div>
<p class="note">Répartition par produit établie à partir des encaissements : paiements du rapport SumUp d'origine
(même date, heure et montant ; encaissés en euros, convertis au taux du passage) et espèces. Les paniers
d'espèces sont reconstitués, faute d'autre enregistrement. Chaque montant déclaré est la somme de son panier.</p>

<table><thead><tr>
 <th class="l">Date</th><th class="l">Paiement</th><th>Montant d'origine</th><th>Déclaré (CHF)</th><th class="l">Articles (prix au stand, CHF)</th>
</tr></thead><tbody>`;

  for (const p of r.paiements) {
    const groupes = new Map<string, number>();
    for (const l of p.lignes) {
      const cle = l.offerte ? `${libelle(l.type)} — offert` : `${libelle(l.type)} à ${chf(l.prixStandCentimes)}`;
      groupes.set(cle, (groupes.get(cle) ?? 0) + 1);
    }
    const panier = [...groupes.entries()].map(([k, n]) => `${n} × ${esc(k)}`).join('<br>');
    html += `<tr class="paiement${p.source === 'especes' ? ' especes' : ''}">` +
      `<td class="l">${dateCourte(p.date)}</td>` +
      `<td class="l">${p.source === 'sumup' ? `SumUp ${esc(p.ref)}` : 'Espèces (reconstitué)'}</td>` +
      `<td>${p.source === 'sumup' ? `${p.montant.toFixed(2)} EUR` : `${chf(p.standCentimes)} CHF`}</td>` +
      `<td>${chf(p.declareCentimes)}</td>` +
      `<td class="l">${panier}</td></tr>`;
  }

  html += `</tbody><tfoot><tr><td class="l" colspan="2">TOTAL — ${r.paiements.length} paiement(s)` +
    `${especes.length ? `, dont ${especes.length} en espèces` : ''}</td>` +
    `<td>${chf(totalEur)} EUR</td><td>${chf(totalDeclare)}</td>` +
    `<td class="l">${r.paiements.reduce((n, p) => n + p.lignes.length, 0)} article(s)</td></tr></tfoot></table>

<h2>Récapitulatif par produit</h2>
<table><thead><tr>
 <th class="l">Objet</th><th class="l">Type Ivy</th><th>Qté sortie</th><th>dont offertes</th><th>CA déclaré (CHF)</th><th>TVA ${passage.vat_pct} % (CHF)</th>
</tr></thead><tbody>${synthese.lignes.map((l) => `<tr>
 <td class="l">${esc(libelle(l.type))}</td><td class="l">${esc(l.type)}</td><td>${l.sorties}</td><td>${l.offertes}</td>
 <td>${chf(l.caCentimes)}</td><td>${chf(l.tvaCentimes)}</td></tr>`).join('')}</tbody>
<tfoot><tr><td class="l" colspan="2">TOTAL</td>
 <td>${synthese.lignes.reduce((n, l) => n + l.sorties, 0)}</td><td>${synthese.lignes.reduce((n, l) => n + l.offertes, 0)}</td>
 <td>${chf(synthese.caCentimes)}</td><td>${chf(synthese.tvaCentimes)}</td></tr></tfoot></table>
<p class="note">TVA ajoutée au CA déclaré : <b>${chf(synthese.tvaCentimes)} CHF</b>, soit <b>${chf(synthese.tvaAPayerCentimes)} CHF</b>
à payer après arrondi aux 5 centimes.</p>
</body></html>`;
  return html;
}
