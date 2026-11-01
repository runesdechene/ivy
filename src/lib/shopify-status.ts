/**
 * Statut Shopify → statut Ivy.
 * Ivy ne connaît que active / draft / archived (+ local, posé par Ivy lui-même).
 * Tout autre statut Shopify (ex. « unlisted », vendable par lien direct) compte comme actif :
 * stocké tel quel, il serait exclu de toutes les lectures filtrées par statut.
 */
export function toIvyStatus(shopifyStatus: string | null | undefined): 'active' | 'draft' | 'archived' {
  return shopifyStatus === 'draft' || shopifyStatus === 'archived' ? shopifyStatus : 'active';
}
