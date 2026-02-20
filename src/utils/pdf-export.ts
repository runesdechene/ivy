import { printInIframe } from '@/utils/print-helpers';

interface PdfVariant {
  title: string;
  sku: string;
  quantity: number;
  cost?: number;
  price?: number;
  options: { name: string; value: string }[];
}

interface PdfProduct {
  title: string;
  productType?: string | null;
  variants: PdfVariant[];
}

interface SummaryByType {
  [type: string]: { count: number; stock: number; value: number; saleValue: number };
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getOptionValue(options: { name: string; value: string }[], targetName: string): string {
  const opt = options.find(o => o.name.toLowerCase().includes(targetName.toLowerCase()));
  return opt?.value || '';
}

const BASE_STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', -apple-system, sans-serif; font-size: 11px; color: #1a1a1a; padding: 24px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 12px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { background: #f1f3f5; text-align: left; padding: 6px 8px; font-weight: 600; font-size: 10px; text-transform: uppercase; border-bottom: 2px solid #dee2e6; }
  td { padding: 5px 8px; border-bottom: 1px solid #eee; }
  tr:last-child td { border-bottom: none; }
  .right { text-align: right; }
  .total-row td { font-weight: 700; border-top: 2px solid #333; background: #f8f9fa; }
  .summary-cards { display: flex; gap: 16px; margin-bottom: 20px; }
  .card { flex: 1; border: 1px solid #dee2e6; border-radius: 8px; padding: 12px; }
  .card-label { font-size: 10px; text-transform: uppercase; color: #666; font-weight: 600; }
  .card-value { font-size: 20px; font-weight: 700; margin-top: 2px; }
  @media print { body { padding: 0; } }
`;

export function printSummaryPdf(
  byProductType: SummaryByType,
  totalStock: number,
  totalStockValue: number,
  locationName?: string,
) {
  const date = new Date().toLocaleDateString('fr-FR');
  const sortedTypes = Object.entries(byProductType).sort((a, b) => b[1].stock - a[1].stock);

  const tableRows = sortedTypes.map(([type, data]) => `
    <tr>
      <td>${type}</td>
      <td class="right">${data.stock.toLocaleString('fr-FR')}</td>
      <td class="right">${fmt(data.value)} &euro;</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Inventaire - Résumé</title>
<style>${BASE_STYLE}</style></head><body>
  <h1>Inventaire - Résumé par type</h1>
  <div class="subtitle">${date}${locationName ? ` &mdash; ${locationName}` : ''}</div>

  <div class="summary-cards">
    <div class="card">
      <div class="card-label">Unités en stock</div>
      <div class="card-value">${totalStock.toLocaleString('fr-FR')}</div>
    </div>
    <div class="card">
      <div class="card-label">Coût du stock</div>
      <div class="card-value">${fmt(totalStockValue)} &euro;</div>
    </div>
  </div>

  <table>
    <thead><tr>
      <th>Type de produit</th>
      <th class="right">Unités</th>
      <th class="right">Coût stock</th>
    </tr></thead>
    <tbody>
      ${tableRows}
      <tr class="total-row">
        <td>TOTAL</td>
        <td class="right">${totalStock.toLocaleString('fr-FR')}</td>
        <td class="right">${fmt(totalStockValue)} &euro;</td>
      </tr>
    </tbody>
  </table>
</body></html>`;

  printInIframe({ content: html });
}

export function printDetailPdf(products: PdfProduct[], locationName?: string) {
  const date = new Date().toLocaleDateString('fr-FR');

  let totalQty = 0;
  let totalCostValue = 0;

  const tableRows = products.flatMap(product =>
    product.variants.map(variant => {
      const qty = Math.max(0, variant.quantity);
      const cost = variant.cost || 0;
      totalQty += qty;
      totalCostValue += qty * cost;

      const couleur = getOptionValue(variant.options, 'couleur')
        || getOptionValue(variant.options, 'color')
        || getOptionValue(variant.options, 'option 2')
        || '';

      const taille = getOptionValue(variant.options, 'taille')
        || getOptionValue(variant.options, 'size')
        || getOptionValue(variant.options, 'option 1')
        || '';

      return `<tr>
        <td>${product.title}</td>
        <td>${product.productType || ''}</td>
        <td>${variant.sku || ''}</td>
        <td>${couleur}</td>
        <td>${taille}</td>
        <td class="right">${qty}</td>
        <td class="right">${fmt(cost)} &euro;</td>
      </tr>`;
    })
  ).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Inventaire - Détail</title>
<style>${BASE_STYLE}
  td, th { font-size: 9px; padding: 3px 5px; }
  @page { size: landscape; margin: 12mm; }
</style></head><body>
  <h1>Inventaire - Détail par variante</h1>
  <div class="subtitle">${date}${locationName ? ` &mdash; ${locationName}` : ''} &mdash; ${totalQty.toLocaleString('fr-FR')} unités</div>

  <table>
    <thead><tr>
      <th>Produit</th>
      <th>Type</th>
      <th>SKU</th>
      <th>Couleur</th>
      <th>Taille</th>
      <th class="right">Qté</th>
      <th class="right">Coût</th>
    </tr></thead>
    <tbody>
      ${tableRows}
      <tr class="total-row">
        <td colspan="5">TOTAL</td>
        <td class="right">${totalQty.toLocaleString('fr-FR')}</td>
        <td class="right">${fmt(totalCostValue)} &euro;</td>
      </tr>
    </tbody>
  </table>
</body></html>`;

  printInIframe({ content: html });
}
