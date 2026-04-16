-- Allow deletion of a product_variant even if it has stock_movements
--
-- Raison : stock_movements.variant_id (migration 033) référençait
-- product_variants(id) SANS ON DELETE, donc NO ACTION. Supprimer une
-- variante locale ayant déjà un mouvement de stock était bloqué.
--
-- On passe le FK à ON DELETE SET NULL et on rend la colonne nullable.
-- Cohérent avec supplier_order_items.variant_id (migration 006) qui suit
-- le même pattern "préserver l'historique, permettre la suppression du
-- parent". Les colonnes product_title / variant_title de stock_movements
-- conservent de toute façon le libellé pour les stats, et le code de
-- /api/pos/study-zones/stats ignore déjà les mouvements dont la variante
-- a disparu.

ALTER TABLE stock_movements
  ALTER COLUMN variant_id DROP NOT NULL;

ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_variant_id_fkey;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_variant_id_fkey
  FOREIGN KEY (variant_id)
  REFERENCES product_variants(id)
  ON DELETE SET NULL;
