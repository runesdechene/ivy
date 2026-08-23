-- Champs exiges par l'admission temporaire suisse (OFDF Publ. 52.03, LD art. 9/58,
-- LTVA art. 54). Voir la spec « Vente incertaine Suisse ».
ALTER TABLE customs_declarations
  -- Identification de la decision de taxation (form. 11.78)
  ADD COLUMN IF NOT EXISTS numero_decision TEXT,
  ADD COLUMN IF NOT EXISTS bureau_douane TEXT,
  -- Deadline d'apurement : passe cette date, les redevances conditionnelles
  -- deviennent exigibles (alerte A2).
  ADD COLUMN IF NOT EXISTS date_expiration DATE,
  ADD COLUMN IF NOT EXISTS surete_deposee_chf DECIMAL(10, 2),

  -- Frais de transport a repartir sur les lignes (R1 : quote-part transport)
  ADD COLUMN IF NOT EXISTS frais_transport_chf DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS methode_repartition TEXT NOT NULL DEFAULT 'VALEUR',

  -- Lieu de vente prevu : mention obligatoire sur la proforma (L1)
  ADD COLUMN IF NOT EXISTS lieu_vente TEXT,

  -- Position tarifaire, origine et taux de TVA par type de produit :
  -- { "Le Confort": { "position": "61091000", "origine": "BD", "tva": 8.1 } }
  ADD COLUMN IF NOT EXISTS tariff_by_type JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Regime de valeur : NEGOCE (prix d'achat) ou PRODUCTION_PROPRE (valeur marchande)
  ADD COLUMN IF NOT EXISTS regime_valeur TEXT NOT NULL DEFAULT 'NEGOCE';

COMMENT ON COLUMN customs_declarations.methode_repartition IS
  'VALEUR ou POIDS : cle de repartition des frais de transport sur les lignes.';
COMMENT ON COLUMN customs_declarations.tariff_by_type IS
  'Par type de produit : position tarifaire SH 8 chiffres, origine ISO, taux de TVA CH (8.1 ou 2.6).';
COMMENT ON COLUMN customs_declarations.date_expiration IS
  'Deadline d''apurement. A2 devient critique une fois depassee.';

-- Quote-part de transport figee sur chaque ligne : la valeur declaree doit rester
-- reproductible a l'identique (contrainte C4).
ALTER TABLE customs_declaration_items
  ADD COLUMN IF NOT EXISTS quote_part_transport_chf DECIMAL(10, 4) NOT NULL DEFAULT 0;
