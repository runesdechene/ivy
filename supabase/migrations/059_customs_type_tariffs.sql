-- Referentiel douanier : un code SH et un libelle par type de produit.
--
-- Jusqu'ici, le code se saisissait sur chaque passage et se reprenait du passage
-- precedent : un type absent du voyage d'avant (L'Eternel) arrivait sans code.
-- Il vit desormais ici, une fois pour toutes. Un passage OUVERT le lit en direct ;
-- a la cloture, les valeurs sont figees dans le passage.
CREATE TABLE IF NOT EXISTS customs_type_tariffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL,

  -- Position tarifaire suisse sur 8 chiffres, stockee sans point : 61091000.
  code_sh TEXT CHECK (code_sh ~ '^[0-9]{8}$'),
  -- Ce que lit le douanier : un mot courant, pas le nom commercial.
  libelle TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_id, product_type)
);

ALTER TABLE customs_type_tariffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membres du shop : lecture du referentiel douanier" ON customs_type_tariffs
  FOR SELECT TO authenticated
  USING (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Membres du shop : ajout au referentiel douanier" ON customs_type_tariffs
  FOR INSERT TO authenticated
  WITH CHECK (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Membres du shop : modification du referentiel douanier" ON customs_type_tariffs
  FOR UPDATE TO authenticated
  USING (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Membres du shop : suppression du referentiel douanier" ON customs_type_tariffs
  FOR DELETE TO authenticated
  USING (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = (SELECT auth.uid())));

-- Amorce depuis le passage d'aout, le seul ou codes et libelles ont ete saisis.
-- Les cles mal encodees (« Le Zipp� ») sont ecartees.
INSERT INTO customs_type_tariffs (shop_id, product_type, code_sh, libelle)
SELECT d.shop_id,
       k.type,
       NULLIF(d.tariff_by_type -> k.type ->> 'position', ''),
       NULLIF(d.customs_labels ->> k.type, '')
FROM customs_declarations d
CROSS JOIN LATERAL (
  SELECT jsonb_object_keys(d.tariff_by_type) AS type
  UNION
  SELECT jsonb_object_keys(d.customs_labels)
) k
WHERE d.departed_on = '2026-08-23'
  AND position(chr(65533) IN k.type) = 0
ON CONFLICT (shop_id, product_type) DO NOTHING;
