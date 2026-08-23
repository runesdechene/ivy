-- Une règle par type de produit : on pèse UNE taille, les autres se déduisent
-- par une variation cumulée d'un cran de taille à l'autre.
CREATE TABLE IF NOT EXISTS weight_type_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL,

  reference_size TEXT NOT NULL,
  reference_grams INTEGER NOT NULL CHECK (reference_grams > 0),
  step_pct DECIMAL(5, 2) NOT NULL DEFAULT 8,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, product_type)
);

CREATE INDEX IF NOT EXISTS idx_weight_type_rules_shop ON weight_type_rules(shop_id);

ALTER TABLE weight_type_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view weight rules of their shops" ON weight_type_rules
  FOR SELECT USING (
    shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert weight rules for their shops" ON weight_type_rules
  FOR INSERT WITH CHECK (
    shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update weight rules of their shops" ON weight_type_rules
  FOR UPDATE USING (
    shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete weight rules of their shops" ON weight_type_rules
  FOR DELETE USING (
    shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid())
  );
