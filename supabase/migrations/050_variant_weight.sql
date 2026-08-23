-- Poids unitaire d'une variante, en grammes.
-- NULL = inconnu (bloque la déclaration douanière). 0 n'est jamais une valeur valide.
ALTER TABLE product_variants
ADD COLUMN IF NOT EXISTS weight_grams INTEGER;

COMMENT ON COLUMN product_variants.weight_grams IS
  'Poids unitaire en grammes. Source : sync Shopify (variant.grams) si > 0, sinon règle de type appliquée, sinon saisie manuelle. NULL = inconnu.';

CREATE INDEX IF NOT EXISTS idx_product_variants_weight_null
  ON product_variants(product_id) WHERE weight_grams IS NULL;
