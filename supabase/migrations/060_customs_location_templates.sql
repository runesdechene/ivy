-- Modele douanier par emplacement : le poids des caisses par type de produit et
-- le materiel d'exposition (tables, chaises, bannieres...) qui voyage avec le stand.
-- Un nouveau passage COPIE ce modele ; on l'ajuste ensuite pour le voyage.
CREATE TABLE IF NOT EXISTS customs_location_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,                        -- shopify_id, comme customs_declarations
  packaging_kg JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { "Le Confort": 18 }
  -- [{ "designation": "Table pliante", "quantite": 2, "poids_kg": 12, "valeur_eur": 60 }]
  -- poids et valeur UNITAIRES ; les totaux se calculent.
  materiel JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_id, location_id)
);

ALTER TABLE customs_location_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membres du shop : lecture des modeles douaniers" ON customs_location_templates
  FOR SELECT TO authenticated
  USING (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Membres du shop : ajout de modeles douaniers" ON customs_location_templates
  FOR INSERT TO authenticated
  WITH CHECK (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Membres du shop : modification des modeles douaniers" ON customs_location_templates
  FOR UPDATE TO authenticated
  USING (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Membres du shop : suppression des modeles douaniers" ON customs_location_templates
  FOR DELETE TO authenticated
  USING (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = (SELECT auth.uid())));

-- Le passage porte sa propre copie, modifiable pour le voyage.
ALTER TABLE customs_declarations
  ADD COLUMN IF NOT EXISTS materiel JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Faute d'avoir tout pese avant le depart, on peut retirer le materiel de la
  -- feuille imprimee sans vider la liste.
  ADD COLUMN IF NOT EXISTS materiel_imprime BOOLEAN NOT NULL DEFAULT TRUE;

-- Amorce : l'emplacement du passage d'aout recoit ses caisses, sans les cles mal encodees.
INSERT INTO customs_location_templates (shop_id, location_id, packaging_kg)
SELECT d.shop_id,
       d.location_id,
       COALESCE((SELECT jsonb_object_agg(k, v)
                 FROM jsonb_each(d.packaging_kg) AS e(k, v)
                 WHERE position(chr(65533) IN k) = 0), '{}'::jsonb)
FROM customs_declarations d
WHERE d.departed_on = '2026-08-23'
ON CONFLICT (shop_id, location_id) DO NOTHING;
