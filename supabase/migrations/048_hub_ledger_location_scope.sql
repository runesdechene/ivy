-- 048_hub_ledger_location_scope.sql
-- Scope le module Comptes de stand PAR EMPLACEMENT.
-- L'app identifie l'emplacement courant par son id Shopify (string, via LocationContext),
-- pas par locations.id (UUID). On stocke donc location_id en TEXT, sans FK.

-- Dépenses : la colonne location_id (UUID FK) devient TEXT (id Shopify).
ALTER TABLE hub_ledger_expenses DROP CONSTRAINT IF EXISTS hub_ledger_expenses_location_id_fkey;
ALTER TABLE hub_ledger_expenses ALTER COLUMN location_id TYPE TEXT USING location_id::text;

-- Caisse : ajout du scope emplacement.
ALTER TABLE hub_ledger_cash_movements ADD COLUMN IF NOT EXISTS location_id TEXT;

CREATE INDEX IF NOT EXISTS idx_hub_expenses_location ON hub_ledger_expenses(shop_id, location_id);
CREATE INDEX IF NOT EXISTS idx_hub_cash_movements_location ON hub_ledger_cash_movements(shop_id, location_id);
