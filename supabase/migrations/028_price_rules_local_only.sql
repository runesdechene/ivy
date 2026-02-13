-- Ajout du flag local_only sur les règles de prix
-- Quand true, la règle ne s'applique qu'aux variantes locales (shopify_active = false)
ALTER TABLE price_rules ADD COLUMN IF NOT EXISTS local_only BOOLEAN DEFAULT FALSE;
