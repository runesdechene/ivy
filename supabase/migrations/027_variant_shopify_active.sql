-- Ajouter un flag pour distinguer les variantes actives sur Shopify
-- des variantes locales (supprimées côté Shopify mais gardées localement)
ALTER TABLE product_variants
ADD COLUMN shopify_active BOOLEAN NOT NULL DEFAULT true;
