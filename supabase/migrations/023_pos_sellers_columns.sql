-- Ajouter les colonnes initials et color à pos_sellers
ALTER TABLE pos_sellers ADD COLUMN IF NOT EXISTS initials VARCHAR(2);
ALTER TABLE pos_sellers ADD COLUMN IF NOT EXISTS color VARCHAR(20);
ALTER TABLE pos_sellers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Supprimer avatar_url si non utilisé (optionnel, commenté pour sécurité)
-- ALTER TABLE pos_sellers DROP COLUMN IF EXISTS avatar_url;
