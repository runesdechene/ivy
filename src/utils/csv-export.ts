interface CsvVariant {
  title: string;
  sku: string;
  quantity: number;
  cost?: number;
  price?: number;
  options: { name: string; value: string }[];
}

interface CsvProduct {
  title: string;
  productType?: string | null;
  variants: CsvVariant[];
}

function escapeCsvField(value: string): string {
  if (value.includes(';') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function getOptionValue(options: { name: string; value: string }[], targetName: string): string {
  const opt = options.find(o =>
    o.name.toLowerCase().includes(targetName.toLowerCase())
  );
  return opt?.value || '';
}

export function generateInventoryCsv(products: CsvProduct[]): string {
  const BOM = '\uFEFF';
  const headers = [
    'Produit', 'Type', 'SKU', 'Variante', 'Couleur', 'Taille',
    'Quantité', 'Coût unitaire (€)', 'Valeur stock (€)',
  ];

  const rows: string[] = [headers.join(';')];

  for (const product of products) {
    for (const variant of product.variants) {
      const qty = Math.max(0, variant.quantity);
      const cost = variant.cost || 0;
      const stockValue = qty * cost;

      const couleur = getOptionValue(variant.options, 'couleur')
        || getOptionValue(variant.options, 'color')
        || getOptionValue(variant.options, 'option 2')
        || '';

      const taille = getOptionValue(variant.options, 'taille')
        || getOptionValue(variant.options, 'size')
        || getOptionValue(variant.options, 'option 1')
        || '';

      const row = [
        escapeCsvField(product.title),
        escapeCsvField(product.productType || ''),
        escapeCsvField(variant.sku || ''),
        escapeCsvField(variant.title || ''),
        escapeCsvField(couleur),
        escapeCsvField(taille),
        qty.toString(),
        cost.toFixed(2).replace('.', ','),
        stockValue.toFixed(2).replace('.', ','),
      ];

      rows.push(row.join(';'));
    }
  }

  return BOM + rows.join('\n');
}

interface SummaryByType {
  [type: string]: { count: number; stock: number; value: number; saleValue: number };
}

export function generateSummaryCsv(
  byProductType: SummaryByType,
  totalStock: number,
  totalStockValue: number,
): string {
  const BOM = '\uFEFF';
  const headers = ['Type de produit', 'Unités', 'Coût stock (€)'];
  const rows: string[] = [headers.join(';')];

  const sortedTypes = Object.entries(byProductType).sort((a, b) => b[1].stock - a[1].stock);

  for (const [type, data] of sortedTypes) {
    rows.push([
      escapeCsvField(type),
      data.stock.toString(),
      data.value.toFixed(2).replace('.', ','),
    ].join(';'));
  }

  // Ligne vide + totaux
  rows.push('');
  rows.push([
    'TOTAL',
    totalStock.toString(),
    totalStockValue.toFixed(2).replace('.', ','),
  ].join(';'));

  return BOM + rows.join('\n');
}

export function downloadCsv(csvContent: string, filename: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
