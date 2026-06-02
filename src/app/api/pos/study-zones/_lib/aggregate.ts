export interface MovementRow {
  variant_id: string | null;
  product_title: string;
  variant_title: string | null;
  quantity: number;
  moved_on: string;
}

export interface AggregateResult {
  totalItemsOut: number;
  totalItemsReturn: number;
  topProducts: Array<{ name: string; quantity: number }>;
  topVariants: Array<{ name: string; quantity: number }>;
  topNames: Array<{ fullName: string; quantity: number }>;
}

/**
 * Agrège une liste de mouvements de stock (sorties = quantity < 0).
 * - topProducts : par product_title exact (liste complète, non bornée).
 * - topVariants : par "product_title — variant_title" (top 20).
 * - topNames (« Fragments ») : par NOM DE DESIGN = partie avant le séparateur
 *   "|" / "—". Surtout PAS de préfixe de longueur fixe (collisionne entre designs
 *   partageant un nom de collection, cf. fix du 2026-06-02 commit 826df29).
 */
export function aggregateMovements(movements: MovementRow[]): AggregateResult {
  const totalItemsOut = movements
    .filter(m => m.quantity < 0)
    .reduce((sum, m) => sum + Math.abs(m.quantity), 0);
  const totalItemsReturn = movements
    .filter(m => m.quantity > 0)
    .reduce((sum, m) => sum + m.quantity, 0);

  // Top products (par product_title exact)
  const productMap = new Map<string, number>();
  for (const m of movements) {
    if (m.quantity < 0) {
      productMap.set(m.product_title, (productMap.get(m.product_title) || 0) + Math.abs(m.quantity));
    }
  }
  const topProducts = Array.from(productMap.entries())
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity);

  // Top variants
  const variantMap = new Map<string, number>();
  for (const m of movements) {
    if (m.quantity < 0) {
      const key = `${m.product_title} — ${m.variant_title || 'Default'}`;
      variantMap.set(key, (variantMap.get(key) || 0) + Math.abs(m.quantity));
    }
  }
  const topVariants = Array.from(variantMap.entries())
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 20);

  // Top names (fragments) — regroupés par nom de design
  const nameMap = new Map<string, { fullName: string; quantity: number }>();
  for (const m of movements) {
    if (m.quantity < 0) {
      const displayName = m.product_title.split('|')[0].split('—')[0].trim();
      const key = displayName.toLowerCase();
      const existing = nameMap.get(key);
      if (existing) {
        existing.quantity += Math.abs(m.quantity);
      } else {
        nameMap.set(key, { fullName: displayName, quantity: Math.abs(m.quantity) });
      }
    }
  }
  const topNames = Array.from(nameMap.values())
    .sort((a, b) => b.quantity - a.quantity);

  return { totalItemsOut, totalItemsReturn, topProducts, topVariants, topNames };
}
