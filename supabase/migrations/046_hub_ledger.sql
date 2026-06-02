-- 046_hub_ledger.sql
-- Module privé "Comptes de stand" : dépenses remboursables + suivi de fond de caisse.
-- Aucune vente/encaissement enregistré (hors périmètre NF525). Données sincères.

-- Réglages du module (1 ligne par shop), porte le hash du PIN
CREATE TABLE IF NOT EXISTS hub_ledger_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL UNIQUE REFERENCES shops(id) ON DELETE CASCADE,
  pin_hash TEXT,                 -- NULL = PIN pas encore défini → écran 1ère config
  pin_set_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tableau A : dépenses engagées remboursables
CREATE TABLE IF NOT EXISTS hub_ledger_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id),
  study_zone_id UUID REFERENCES pos_study_zones(id),
  spent_on DATE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount DECIMAL(10,2) NOT NULL,
  receipt_path TEXT,
  status TEXT NOT NULL DEFAULT 'engage',  -- engage | soumis | rembourse
  created_by_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tableau B (en-tête) : fond de caisse par festival
CREATE TABLE IF NOT EXISTS hub_ledger_cash_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id),
  study_zone_id UUID REFERENCES pos_study_zones(id),
  opening_float DECIMAL(10,2) NOT NULL DEFAULT 0,
  opened_on DATE NOT NULL,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tableau B (lignes) : sorties piochées dans la caisse
CREATE TABLE IF NOT EXISTS hub_ledger_cash_outflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES hub_ledger_cash_sessions(id) ON DELETE CASCADE,
  spent_on DATE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount DECIMAL(10,2) NOT NULL,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hub_expenses_shop ON hub_ledger_expenses(shop_id);
CREATE INDEX IF NOT EXISTS idx_hub_expenses_zone ON hub_ledger_expenses(study_zone_id);
CREATE INDEX IF NOT EXISTS idx_hub_cash_sessions_shop ON hub_ledger_cash_sessions(shop_id);
CREATE INDEX IF NOT EXISTS idx_hub_cash_outflows_session ON hub_ledger_cash_outflows(session_id);

-- RLS : accès réservé aux membres du shop (pattern IVY user_shops).
-- Compte unique aujourd'hui → seul ce compte. Les routes serveur passent en service_role
-- (RLS bypassée) MAIS revérifient l'appartenance + exigent un jeton PIN.
ALTER TABLE hub_ledger_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_ledger_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_ledger_cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_ledger_cash_outflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_settings_member" ON hub_ledger_settings FOR ALL
  USING (EXISTS (SELECT 1 FROM user_shops us WHERE us.shop_id = hub_ledger_settings.shop_id AND us.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM user_shops us WHERE us.shop_id = hub_ledger_settings.shop_id AND us.user_id = auth.uid()));

CREATE POLICY "hub_expenses_member" ON hub_ledger_expenses FOR ALL
  USING (EXISTS (SELECT 1 FROM user_shops us WHERE us.shop_id = hub_ledger_expenses.shop_id AND us.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM user_shops us WHERE us.shop_id = hub_ledger_expenses.shop_id AND us.user_id = auth.uid()));

CREATE POLICY "hub_cash_sessions_member" ON hub_ledger_cash_sessions FOR ALL
  USING (EXISTS (SELECT 1 FROM user_shops us WHERE us.shop_id = hub_ledger_cash_sessions.shop_id AND us.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM user_shops us WHERE us.shop_id = hub_ledger_cash_sessions.shop_id AND us.user_id = auth.uid()));

CREATE POLICY "hub_cash_outflows_member" ON hub_ledger_cash_outflows FOR ALL
  USING (EXISTS (SELECT 1 FROM hub_ledger_cash_sessions s JOIN user_shops us ON us.shop_id = s.shop_id WHERE s.id = hub_ledger_cash_outflows.session_id AND us.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM hub_ledger_cash_sessions s JOIN user_shops us ON us.shop_id = s.shop_id WHERE s.id = hub_ledger_cash_outflows.session_id AND us.user_id = auth.uid()));

-- Bucket Storage privé pour les reçus (accès uniquement via routes serveur service_role)
INSERT INTO storage.buckets (id, name, public)
VALUES ('hub-receipts', 'hub-receipts', false)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE hub_ledger_expenses IS 'Dépenses engagées remboursables (note de frais apprenti). Pas une caisse.';
COMMENT ON TABLE hub_ledger_cash_sessions IS 'Fond de caisse cash par festival. Solde = opening_float - somme des outflows.';
