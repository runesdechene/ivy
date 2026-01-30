-- Ajouter la colonne price pour stocker le prix de vente Shopify des variantes

ALTER TABLE product_variants 
ADD COLUMN IF NOT EXISTS price DECIMAL(10, 2) DEFAULT 0;

COMMENT ON COLUMN product_variants.price IS 'Prix de vente Shopify de la variante';
