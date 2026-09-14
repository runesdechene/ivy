-- Les caisses deviennent des fournitures du stand, cochees « caisse ».
--
-- Une caisse melange les types de produits : lui attribuer un type etait une
-- fausse precision, et le 11.74 ne demande qu'un poids brut total (case 24).
-- Chaque objet de `materiel` porte desormais `caisse` (booleen, absent = false).
--
-- Les modeles d'emplacement perdent leur grille par type ; son total devient une
-- ligne « Caisses (total repris d'aout) », pour que le poids brut ne bouge pas.
-- Les passages CLOTURES gardent leurs caisses par type : ils sont figes.
UPDATE customs_location_templates t
SET materiel = t.materiel || jsonb_build_array(jsonb_build_object(
      'designation', 'Caisses (total repris d''août)',
      'quantite', 1,
      'poids_kg', s.total,
      'valeur_eur', 0,
      'caisse', true)),
    packaging_kg = '{}'::jsonb,
    updated_at = NOW()
FROM (
  SELECT id, SUM((v)::numeric) AS total
  FROM customs_location_templates, jsonb_each_text(packaging_kg) AS e(k, v)
  GROUP BY id
) s
WHERE s.id = t.id AND s.total > 0;

COMMENT ON COLUMN customs_location_templates.packaging_kg IS
  'Obsolete depuis 061 : les caisses sont des fournitures cochees « caisse » dans materiel.';
