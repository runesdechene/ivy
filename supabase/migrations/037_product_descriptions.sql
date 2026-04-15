-- Product description templates with conditions
CREATE TABLE IF NOT EXISTS product_descriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description_html TEXT NOT NULL DEFAULT '',
  conditions JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_product_descriptions_shop ON product_descriptions(shop_id);

ALTER TABLE product_descriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage product descriptions for their shops"
  ON product_descriptions FOR ALL
  USING (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid()));
