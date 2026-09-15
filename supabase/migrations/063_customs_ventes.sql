-- Ventes reconstituees au retour d'un festival.
--
-- Referentiel : le prix affiche au stand (plafond) et le prix minimal plausible
-- (plancher, en dessous la piece est offerte), par type, en CHF.
ALTER TABLE customs_type_tariffs
  ADD COLUMN IF NOT EXISTS prix_affiche_chf DECIMAL(10, 2) CHECK (prix_affiche_chf > 0),
  ADD COLUMN IF NOT EXISTS prix_minimal_chf DECIMAL(10, 2) CHECK (prix_minimal_chf >= 0),
  ADD CONSTRAINT customs_type_tariffs_prix_coherents
    CHECK (prix_minimal_chf IS NULL OR prix_affiche_chf IS NULL OR prix_minimal_chf <= prix_affiche_chf);

COMMENT ON COLUMN customs_type_tariffs.prix_affiche_chf IS
  'Prix affiche au stand, CHF : plafond de la reconstitution des ventes.';
COMMENT ON COLUMN customs_type_tariffs.prix_minimal_chf IS
  'Prix le plus bas plausible, CHF : en dessous, la piece est offerte.';

-- Valeurs donnees par Uriel (Fribourg, aout 2026). Le prix affiche de L'Eternel reste a saisir.
UPDATE customs_type_tariffs t SET
  prix_affiche_chf = v.affiche, prix_minimal_chf = v.minimal, updated_at = NOW()
FROM (VALUES
  ('Le Confort', 50::numeric, 20::numeric),
  ('Débardeur Femme', 40, 15),
  ('Débardeur Homme', 40, 15),
  ('Le Moelleux', 90, 70),
  ('Le Zippé', 110, 80),
  ('L''Éternel', NULL, 80)
) AS v(type, affiche, minimal)
WHERE t.product_type = v.type;

-- Passage : la reconstitution figee (entrees + resultat), voir la spec du 2026-09-15.
-- Document attache au passage : rien n'est ecrit dans le stock (Ivy n'est pas une caisse).
ALTER TABLE customs_declarations
  ADD COLUMN IF NOT EXISTS reconstitution JSONB;

COMMENT ON COLUMN customs_declarations.reconstitution IS
  'Ventes reconstituees au retour (SumUp + especes), figees avec leurs entrees. NULL tant qu''aucune.';
