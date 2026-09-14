-- Origine du textile par type de produit, dans le referentiel douanier.
--
-- Elle etait saisie une fois pour tout le passage (customs_declarations.origin),
-- alors qu'un sweat et un t-shirt peuvent venir de pays differents. Elle vit
-- desormais a cote du code SH et du libelle ; un passage ouvert la lit en direct,
-- un passage cloture la fige dans tariff_by_type.origine.
-- A ne pas confondre avec origine_declaree : le pays inscrit en case 10 du 11.74.
ALTER TABLE customs_type_tariffs
  ADD COLUMN IF NOT EXISTS origine TEXT CHECK (origine ~ '^[A-Z]{2}$');

COMMENT ON COLUMN customs_type_tariffs.origine IS
  'Pays de fabrication du textile, code ISO a 2 lettres (BD). Distinct de la case 10 du 11.74.';

-- Les types deja renseignes heritent de l'origine unique utilisee jusqu'ici.
UPDATE customs_type_tariffs SET origine = 'BD', updated_at = NOW() WHERE origine IS NULL;

COMMENT ON COLUMN customs_declarations.origin IS
  'Obsolete depuis 062 pour l''affichage : l''origine du textile est par type (customs_type_tariffs.origine). Repli pour les passages anterieurs.';
