-- Containers (caisses physiques) - types globaux + instances par emplacement
CREATE TABLE IF NOT EXISTS container_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  max_capacity INTEGER NOT NULL CHECK (max_capacity > 0),
  empty_weight_g INTEGER,
  ratio_w SMALLINT NOT NULL DEFAULT 1 CHECK (ratio_w > 0),
  ratio_h SMALLINT NOT NULL DEFAULT 1 CHECK (ratio_h > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_container_types_shop ON container_types(shop_id);

CREATE TABLE IF NOT EXISTS container_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  container_type_id UUID NOT NULL REFERENCES container_types(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_container_instances_shop_loc ON container_instances(shop_id, location_id);

CREATE TABLE IF NOT EXISTS container_instance_products (
  container_instance_id UUID NOT NULL REFERENCES container_instances(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (container_instance_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_cip_product ON container_instance_products(product_id);

-- RLS
ALTER TABLE container_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE container_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE container_instance_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage container_types for their shops"
  ON container_types FOR ALL
  USING (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage container_instances for their shops"
  ON container_instances FOR ALL
  USING (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage container_instance_products via instance access"
  ON container_instance_products FOR ALL
  USING (
    container_instance_id IN (
      SELECT id FROM container_instances
      WHERE shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid())
    )
  );

COMMENT ON COLUMN container_instances.location_id IS
  'Shopify location id (string, not the Supabase locations.id UUID). Aligns with inventory_levels.location_id.';
