-- Libelle douanier par type de produit, propre a chaque passage.
-- La douane veut des mots courants ("t-shirt", "sweat-shirt"), pas les noms
-- commerciaux de la marque ("Le Confort", "Le Zippe").
ALTER TABLE customs_declarations
ADD COLUMN IF NOT EXISTS customs_labels JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN customs_declarations.customs_labels IS
  'Libelle douanier par type de produit : { "Le Confort": "T-shirt coton" }. Saisi a la main, fige avec le passage.';
