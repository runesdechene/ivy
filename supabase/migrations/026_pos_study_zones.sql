-- Zones d'étude pour les statistiques de ventes stand
CREATE TABLE IF NOT EXISTS pos_study_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_study_zones_shop ON pos_study_zones(shop_id);

ALTER TABLE pos_study_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pos_study_zones_select" ON pos_study_zones FOR SELECT USING (true);
CREATE POLICY "pos_study_zones_insert" ON pos_study_zones FOR INSERT WITH CHECK (true);
CREATE POLICY "pos_study_zones_update" ON pos_study_zones FOR UPDATE USING (true);
CREATE POLICY "pos_study_zones_delete" ON pos_study_zones FOR DELETE USING (true);

COMMENT ON TABLE pos_study_zones IS 'Zones d''étude pour analyser les ventes sur une période donnée (ex: festival, marché de Noël)';
