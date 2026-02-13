-- Ajout de l'ordre de tri pour les règles de prix (drag-and-drop)
ALTER TABLE price_rules ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
