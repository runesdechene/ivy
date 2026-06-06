export function isColorColumn(label: string): boolean {
  const lower = label.toLowerCase();
  return lower.includes('couleur') || lower.includes('color');
}
