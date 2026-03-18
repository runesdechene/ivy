-- Migrate historical pos_sale_items into stock_movements (quantities only, no prices)
INSERT INTO stock_movements (shop_id, location_id, variant_id, product_title, variant_title, quantity, moved_on, created_at)
SELECT
  s.shop_id,
  s.location_id,
  i.variant_id,
  i.product_title,
  i.variant_title,
  CASE WHEN s.is_refund THEN i.quantity ELSE -i.quantity END,
  (s.created_at AT TIME ZONE 'Europe/Paris')::date,
  s.created_at
FROM pos_sale_items i
JOIN pos_sales s ON s.id = i.sale_id
WHERE i.variant_id IS NOT NULL
ON CONFLICT DO NOTHING;
