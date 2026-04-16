-- Drop FK pos_sale_items.variant_id → product_variants(id)
--
-- Raison : pos_sale_items est legacy depuis la mise en conformité NF525
-- (mars 2026). La table n'est plus écrite et ses données historiques ont
-- été migrées dans stock_movements (migration 034). La FK, créée sans
-- ON DELETE (migration 022), bloque la suppression de variantes locales
-- référencées par d'anciennes lignes de vente. On la supprime pour
-- débloquer /api/inventory/delete-variant.

ALTER TABLE pos_sale_items
  DROP CONSTRAINT IF EXISTS pos_sale_items_variant_id_fkey;
