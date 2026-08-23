-- Poids d'emballage par type de produit, en kg.
-- Un seul poids brut global etait une mauvaise modelisation : les t-shirts et
-- les sweats ne voyagent pas dans les memes caisses. Le brut d'un type vaut
-- donc son poids net plus le poids de SES caisses.
ALTER TABLE customs_declarations
ADD COLUMN IF NOT EXISTS packaging_kg JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN customs_declarations.packaging_kg IS
  'Poids des caisses par type de produit, en kg : { "Le Confort": 4.5 }. Le poids brut d''un type = poids net + cette valeur.';
