-- 045 — Caisses en mode filtre : passage à des filtres multi-valeurs
-- (plusieurs types de produit / plusieurs tailles dans une même caisse).

ALTER TABLE container_instances
  ALTER COLUMN filter_product_type TYPE TEXT[]
    USING CASE
      WHEN filter_product_type IS NULL THEN NULL
      ELSE ARRAY[filter_product_type]
    END,
  ALTER COLUMN filter_size TYPE TEXT[]
    USING CASE
      WHEN filter_size IS NULL THEN NULL
      ELSE ARRAY[filter_size]
    END;

COMMENT ON COLUMN container_instances.filter_product_type IS
  'Liste des product_type qui matchent (OR). Si non NULL et non vide, passe la caisse en mode filtre. Mutuellement exclusif avec container_instance_products côté UI mais coexiste en base.';

COMMENT ON COLUMN container_instances.filter_size IS
  'Liste des tailles extraites qui matchent (OR). Si non NULL et non vide, restreint la caisse aux variants dont la taille (option Shopify "Taille"/"Size") matche une des valeurs.';

DROP INDEX IF EXISTS idx_container_instances_filter_type;
CREATE INDEX IF NOT EXISTS idx_container_instances_filter_type
  ON container_instances USING GIN (filter_product_type)
  WHERE filter_product_type IS NOT NULL;
