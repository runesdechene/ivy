-- Mode "filtre" pour container_instances : la caisse auto-collecte les variants
-- qui matchent product_type ET/OU size, au lieu d'utiliser
-- container_instance_products. Au moins un des deux doit être renseigné pour
-- activer le mode filtre.
ALTER TABLE container_instances
  ADD COLUMN IF NOT EXISTS filter_product_type TEXT,
  ADD COLUMN IF NOT EXISTS filter_size TEXT;

COMMENT ON COLUMN container_instances.filter_product_type IS
  'Si renseigné (avec ou sans filter_size), la caisse passe en mode filtre et auto-collecte les variants des produits dont products.product_type matche. Mutuellement exclusif avec container_instance_products côté UI mais coexiste en base.';

COMMENT ON COLUMN container_instances.filter_size IS
  'Si renseigné (avec ou sans filter_product_type), la caisse auto-collecte les variants dont la taille extraite via les options Shopify matche cette valeur (ex: "M", "L", "XS").';

CREATE INDEX IF NOT EXISTS idx_container_instances_filter_type
  ON container_instances(shop_id, filter_product_type)
  WHERE filter_product_type IS NOT NULL;
