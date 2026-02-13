-- Ajout du titre sur les règles de prix
-- Le titre nomme la règle dans l'interface, le product_type reste un ciblage technique
ALTER TABLE price_rules ADD COLUMN IF NOT EXISTS title VARCHAR(255);
