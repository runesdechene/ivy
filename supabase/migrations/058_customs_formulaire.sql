-- Ce qui se recopie sur le formulaire officiel 11.74, case par case.
--
-- Deux origines distinctes, qu'on confondait dans la seule colonne `origin` :
--   origin            : origine du TEXTILE (BD) — la fabrication du vetement.
--   origine_declaree  : pays d'origine inscrit en case 10 du 11.74 (FR) — celui
--                       que le douanier a accepte au guichet.
ALTER TABLE customs_declarations
  ADD COLUMN IF NOT EXISTS origine_declaree TEXT NOT NULL DEFAULT 'FR',
  -- Case 17 : designation exacte de la marchandise, en une phrase.
  ADD COLUMN IF NOT EXISTS designation_formulaire TEXT,
  -- Case 20 : numero de tarif de la ligne unique du formulaire (6110.2000).
  ADD COLUMN IF NOT EXISTS tarif_formulaire TEXT;

COMMENT ON COLUMN customs_declarations.origin IS
  'Origine du textile (pays de fabrication), code ISO. Distinct de origine_declaree.';
COMMENT ON COLUMN customs_declarations.origine_declaree IS
  'Pays d''origine inscrit en case 10 du formulaire 11.74.';
COMMENT ON COLUMN customs_declarations.designation_formulaire IS
  'Case 17 du 11.74 : designation de la marchandise. Recopiee du passage precedent.';
COMMENT ON COLUMN customs_declarations.tarif_formulaire IS
  'Case 20 du 11.74 : numero de tarif de la ligne unique. Recopie du passage precedent.';

-- Le passage d'aout a ete declare ainsi : on l'inscrit pour que le suivant en herite.
UPDATE customs_declarations
SET designation_formulaire = COALESCE(designation_formulaire, 'T-shirts et sweatshirts en coton de la marque Runes de Chêne'),
    tarif_formulaire = COALESCE(tarif_formulaire, '6110.2000'),
    bureau_douane = COALESCE(bureau_douane, 'Bardonnex')
WHERE departed_on = '2026-08-23';
