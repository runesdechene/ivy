-- Compensation prix sur stand : montant +/- par article en caisse
CREATE TABLE IF NOT EXISTS pos_stand_adjustment (
  shop_id UUID PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE pos_stand_adjustment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pos_stand_adjustment_select" ON pos_stand_adjustment FOR SELECT USING (true);
CREATE POLICY "pos_stand_adjustment_insert" ON pos_stand_adjustment FOR INSERT WITH CHECK (true);
CREATE POLICY "pos_stand_adjustment_update" ON pos_stand_adjustment FOR UPDATE USING (true);
