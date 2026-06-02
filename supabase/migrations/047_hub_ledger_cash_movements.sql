-- 047_hub_ledger_cash_movements.sql
-- Simplifie le suivi de caisse : UNE caisse globale par shop.
-- Solde = somme de mouvements signés justifiés (montant > 0 = entrée, < 0 = sortie).
-- Remplace l'ancien modèle session + outflows (jamais mis en prod).

DROP TABLE IF EXISTS hub_ledger_cash_outflows;
DROP TABLE IF EXISTS hub_ledger_cash_sessions;

CREATE TABLE IF NOT EXISTS hub_ledger_cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  occurred_on DATE NOT NULL,
  amount DECIMAL(10,2) NOT NULL,            -- signé : > 0 = entrée, < 0 = sortie
  justification TEXT NOT NULL DEFAULT '',
  created_by_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hub_cash_movements_shop ON hub_ledger_cash_movements(shop_id);

ALTER TABLE hub_ledger_cash_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_cash_movements_member" ON hub_ledger_cash_movements FOR ALL
  USING (EXISTS (SELECT 1 FROM user_shops us WHERE us.shop_id = hub_ledger_cash_movements.shop_id AND us.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM user_shops us WHERE us.shop_id = hub_ledger_cash_movements.shop_id AND us.user_id = auth.uid()));

COMMENT ON TABLE hub_ledger_cash_movements IS 'Mouvements de caisse cash justifiés (signés). Solde = somme. Outil de gestion de caisse, pas de ventes détaillées.';
