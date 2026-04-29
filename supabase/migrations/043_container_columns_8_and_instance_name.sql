-- Étendre le max columns à 8 (au lieu de 5)
ALTER TABLE container_types DROP CONSTRAINT IF EXISTS container_types_columns_check;
ALTER TABLE container_types ADD CONSTRAINT container_types_columns_check CHECK (columns BETWEEN 1 AND 8);

-- Permettre de renommer une instance de caisse (nom custom optionnel)
ALTER TABLE container_instances ADD COLUMN IF NOT EXISTS name TEXT;

COMMENT ON COLUMN container_instances.name IS
  'Nom custom optionnel donné par l''utilisateur (ex: "Caisse n°1"). Si NULL, on affiche le nom du type.';
