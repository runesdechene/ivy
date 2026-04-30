const SIZE_ORDER = [
  'XXS',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  '2XL',
  '3XL',
  '4XL',
  '5XL'
];

/**
 * Normalise une taille vers la notation canonique : "XXL"→"2XL", "XXXL"→"3XL", etc.
 * Les tailles déjà canoniques (S, M, L, XL, 2XL, …) sont inchangées (à part trim/upper).
 * Plusieurs fournisseurs Shopify livrent "XXL" et d'autres "2XL" — on harmonise au match.
 */
export function normalizeSize(size: string | null | undefined): string | null {
  if (!size) return null;
  const trimmed = String(size).trim().toUpperCase();
  if (!trimmed) return null;
  // "XXL"+ → "2XL"+ (mais "XL" reste "XL", "XS" n'est pas concerné car finit par S)
  const xMatch = trimmed.match(/^(X+)L$/);
  if (xMatch && xMatch[1].length >= 2) {
    return `${xMatch[1].length}XL`;
  }
  return trimmed;
}

/**
 * Obtient l'index de tri d'une taille
 * @param size Taille à évaluer
 * @returns Index dans l'ordre de tri (-1 si non trouvé)
 */
export function getSizeIndex(size: string | null | undefined): number {
  const normalized = normalizeSize(size);
  if (!normalized) return -1;
  return SIZE_ORDER.indexOf(normalized);
}

/**
 * Compare deux tailles pour le tri
 * @param sizeA Première taille
 * @param sizeB Deuxième taille
 * @returns -1 si sizeA < sizeB, 0 si égal, 1 si sizeA > sizeB
 */
export function compareSizes(sizeA: string | null | undefined, sizeB: string | null | undefined): number {
  const indexA = getSizeIndex(sizeA);
  const indexB = getSizeIndex(sizeB);

  // Si les deux tailles ne sont pas dans la liste, on les compare alphabétiquement
  if (indexA === -1 && indexB === -1) {
    return (sizeA || '').localeCompare(sizeB || '');
  }

  // Si une seule taille n'est pas dans la liste, on la met à la fin
  if (indexA === -1) return 1;
  if (indexB === -1) return -1;

  // Sinon on compare leurs indices
  return indexA - indexB;
}
