-- Passages en douane. Un passage porte DEUX instantanes : le depart (aller) et
-- le retour. L'utilisateur ne choisit jamais un sens : il ouvre un passage, ou
-- il cloture celui qui est ouvert. Le retour est donc structurellement rattache
-- au bon depart.
CREATE TABLE IF NOT EXISTS customs_declarations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,              -- shopify_id de l'emplacement
  location_name TEXT NOT NULL,            -- recopie : lisible meme si l'emplacement disparait

  status TEXT NOT NULL DEFAULT 'open',    -- open (aller fait) | closed (retour fait)
  reference TEXT,                         -- numero de formulaire 1187

  -- Parametres modifiables tant que le passage est ouvert
  departed_on DATE NOT NULL DEFAULT CURRENT_DATE,
  eur_to_chf DECIMAL(10, 5) NOT NULL,
  vat_pct DECIMAL(5, 2) NOT NULL DEFAULT 8.1,
  gross_weight_kg DECIMAL(10, 3),
  origin TEXT NOT NULL DEFAULT 'BD',
  prices_chf_ttc JSONB NOT NULL DEFAULT '{}'::jsonb,  -- prix TTC par type de produit

  departure_snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  returned_on DATE,
  return_snapshot_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un seul passage ouvert par emplacement : deux instantanes concurrents se
-- marcheraient dessus.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customs_one_open_per_location
  ON customs_declarations(shop_id, location_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_customs_declarations_shop ON customs_declarations(shop_id);

-- L'instantane fige au clic. Les libelles sont recopies : la declaration doit
-- rester lisible meme si le produit est renomme ou supprime ensuite.
CREATE TABLE IF NOT EXISTS customs_declaration_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_id UUID NOT NULL REFERENCES customs_declarations(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,

  product_title TEXT NOT NULL,
  product_type TEXT,
  image_url TEXT,
  variant_title TEXT,
  size TEXT,
  color TEXT,

  qty_departed INTEGER NOT NULL,
  qty_returned INTEGER,
  qty_sold_recorded INTEGER,

  weight_grams INTEGER,
  unit_cost_textile DECIMAL(10, 2),
  unit_cost_print DECIMAL(10, 2),
  unit_price_eur DECIMAL(10, 2),

  incomplete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customs_items_declaration
  ON customs_declaration_items(declaration_id);

ALTER TABLE customs_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE customs_declaration_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membres du shop : passages en douane" ON customs_declarations
  FOR ALL USING (shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid()));

CREATE POLICY "Membres du shop : lignes de passage" ON customs_declaration_items
  FOR ALL USING (
    declaration_id IN (
      SELECT id FROM customs_declarations
      WHERE shop_id IN (SELECT shop_id FROM user_shops WHERE user_id = auth.uid())
    )
  );
