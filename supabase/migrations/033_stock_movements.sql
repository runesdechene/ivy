-- Stock movements log (no prices, just quantities)
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id),
  variant_id UUID NOT NULL REFERENCES product_variants(id),
  product_title VARCHAR(255) NOT NULL,
  variant_title VARCHAR(255),
  quantity INTEGER NOT NULL, -- negative = out, positive = return
  moved_on DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for stats queries by shop + date range
CREATE INDEX idx_stock_movements_shop_date ON stock_movements(shop_id, moved_on);
CREATE INDEX idx_stock_movements_location ON stock_movements(shop_id, location_id, moved_on);

-- RLS
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view stock movements for their shops"
  ON stock_movements FOR SELECT
  USING (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert stock movements for their shops"
  ON stock_movements FOR INSERT
  WITH CHECK (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid()));
