-- Identite du declarant et de la manifestation : ce que le douanier lit en tete
-- de la feuille de synthese.
ALTER TABLE customs_declarations
  ADD COLUMN IF NOT EXISTS raison_sociale TEXT,
  ADD COLUMN IF NOT EXISTS nom_prenom TEXT,
  ADD COLUMN IF NOT EXISTS adresse_siege TEXT,
  ADD COLUMN IF NOT EXISTS adresse_exposition TEXT,
  ADD COLUMN IF NOT EXISTS date_exposition TEXT,
  ADD COLUMN IF NOT EXISTS date_retour_prevue DATE,
  -- Date a laquelle le regime doit etre apure (retour de la marchandise).
  ADD COLUMN IF NOT EXISTS date_apurement DATE;

COMMENT ON COLUMN customs_declarations.date_exposition IS
  'Dates de la manifestation, en texte libre : elles s''ecrivent souvent « du 26 au 28 aout ».';
