-- Date du dernier envoi sur Shopify de chaque mockup : un mockup régénéré depuis (updated_at > envoye_le)
-- est « pas à jour sur Shopify ». NULL = jamais envoyé.
ALTER TABLE mockups ADD COLUMN IF NOT EXISTS envoye_le TIMESTAMPTZ;
