-- Nombre de colonnes/compartiments visuels d'une caisse (1, 2 ou 3)
ALTER TABLE container_types ADD COLUMN IF NOT EXISTS columns SMALLINT NOT NULL DEFAULT 1
  CHECK (columns BETWEEN 1 AND 5);

COMMENT ON COLUMN container_types.columns IS
  'Nombre de compartiments visuels de la caisse (1 = pleine, 2 ou 3 = séparée). Affecte uniquement le rendu Tetris.';
