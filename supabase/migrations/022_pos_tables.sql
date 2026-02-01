-- Tables pour le système de caisse (POS - Point of Sale)

-- Vendeurs du point de vente
CREATE TABLE IF NOT EXISTS pos_sellers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  initials VARCHAR(2),
  color VARCHAR(20),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Règles de remise dynamiques
CREATE TABLE IF NOT EXISTS pos_discount_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  expression TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  is_combinable BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ventes (en-tête)
CREATE TABLE IF NOT EXISTS pos_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id),
  seller_id UUID REFERENCES pos_sellers(id),
  discount_rule_id UUID REFERENCES pos_discount_rules(id),
  subtotal DECIMAL(10,2) NOT NULL,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL,
  items_count INTEGER NOT NULL,
  is_refund BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by_user_id TEXT
);

-- Lignes de vente (détail)
CREATE TABLE IF NOT EXISTS pos_sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id),
  product_title VARCHAR(255) NOT NULL,
  variant_title VARCHAR(255),
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  discount_percentage DECIMAL(5,2) DEFAULT 0,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  total_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour les statistiques et performances
CREATE INDEX IF NOT EXISTS idx_pos_sellers_shop ON pos_sellers(shop_id);
CREATE INDEX IF NOT EXISTS idx_pos_discount_rules_shop ON pos_discount_rules(shop_id);
CREATE INDEX IF NOT EXISTS idx_pos_sales_shop_date ON pos_sales(shop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pos_sales_seller ON pos_sales(seller_id);
CREATE INDEX IF NOT EXISTS idx_pos_sales_location ON pos_sales(location_id);
CREATE INDEX IF NOT EXISTS idx_pos_sale_items_sale ON pos_sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_pos_sale_items_variant ON pos_sale_items(variant_id);

-- RLS Policies
ALTER TABLE pos_sellers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_discount_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_sale_items ENABLE ROW LEVEL SECURITY;

-- Policies pour pos_sellers
CREATE POLICY "pos_sellers_select" ON pos_sellers FOR SELECT USING (true);
CREATE POLICY "pos_sellers_insert" ON pos_sellers FOR INSERT WITH CHECK (true);
CREATE POLICY "pos_sellers_update" ON pos_sellers FOR UPDATE USING (true);
CREATE POLICY "pos_sellers_delete" ON pos_sellers FOR DELETE USING (true);

-- Policies pour pos_discount_rules
CREATE POLICY "pos_discount_rules_select" ON pos_discount_rules FOR SELECT USING (true);
CREATE POLICY "pos_discount_rules_insert" ON pos_discount_rules FOR INSERT WITH CHECK (true);
CREATE POLICY "pos_discount_rules_update" ON pos_discount_rules FOR UPDATE USING (true);
CREATE POLICY "pos_discount_rules_delete" ON pos_discount_rules FOR DELETE USING (true);

-- Policies pour pos_sales
CREATE POLICY "pos_sales_select" ON pos_sales FOR SELECT USING (true);
CREATE POLICY "pos_sales_insert" ON pos_sales FOR INSERT WITH CHECK (true);
CREATE POLICY "pos_sales_update" ON pos_sales FOR UPDATE USING (true);
CREATE POLICY "pos_sales_delete" ON pos_sales FOR DELETE USING (true);

-- Policies pour pos_sale_items
CREATE POLICY "pos_sale_items_select" ON pos_sale_items FOR SELECT USING (true);
CREATE POLICY "pos_sale_items_insert" ON pos_sale_items FOR INSERT WITH CHECK (true);
CREATE POLICY "pos_sale_items_update" ON pos_sale_items FOR UPDATE USING (true);
CREATE POLICY "pos_sale_items_delete" ON pos_sale_items FOR DELETE USING (true);

-- Commentaires
COMMENT ON TABLE pos_sellers IS 'Vendeurs pour le point de vente sur stand';
COMMENT ON TABLE pos_discount_rules IS 'Règles de remise dynamiques avec langage de logique';
COMMENT ON TABLE pos_sales IS 'En-têtes des ventes effectuées en caisse';
COMMENT ON TABLE pos_sale_items IS 'Lignes de détail des ventes';
COMMENT ON COLUMN pos_discount_rules.expression IS 'Expression du langage de logique pour calculer la remise';
COMMENT ON COLUMN pos_sale_items.quantity IS 'Peut être négatif pour les remboursements';
