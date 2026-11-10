-- Module Mockups : gabarits photo, mockups générés, réglages des teintes,
-- fiches de tailles par motif, profils de tailles par modèle.

CREATE TABLE IF NOT EXISTS mockup_gabarits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  modele TEXT NOT NULL,              -- SKU Shopify exact, ex. 'DRUMMER 2.0'
  couleur TEXT NOT NULL,             -- option « Couleur » Shopify, ex. 'Noir'
  face TEXT NOT NULL CHECK (face IN ('recto', 'verso')),
  photo_path TEXT NOT NULL,
  ombres_clair_path TEXT,
  ombres_sombre_path TEXT,
  cadre_x REAL NOT NULL, cadre_y REAL NOT NULL, cadre_hauteur REAL NOT NULL,  -- px sur la photo ; hauteur = 49,5 cm
  poitrine_x REAL, poitrine_y REAL,  -- haut-centre de la marque ou du logo DTF, recto seulement
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (shop_id, modele, couleur, face)
);

CREATE TABLE IF NOT EXISTS mockups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  couleur TEXT NOT NULL,
  face TEXT NOT NULL CHECK (face IN ('recto', 'verso')),
  image_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (shop_id, product_id, couleur, face)
);
CREATE INDEX IF NOT EXISTS idx_mockups_product ON mockups(product_id);

-- Une ligne par boutique
CREATE TABLE IF NOT EXISTS mockup_reglages (
  shop_id UUID PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  teintes JSONB NOT NULL DEFAULT '{}',   -- { "CUI": { "couleur": "#c9b79c", "version": "SOMBRE" }, … }
  dtf_path TEXT,                         -- logo DTF commun (cœur)
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fiche de tailles d'un motif : hauteur du dessin en cm par taille d'impression
CREATE TABLE IF NOT EXISTS mockup_motifs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,                     -- cleMotif du nom de dossier, ex. 'LOKI'
  hauteurs JSONB NOT NULL DEFAULT '{}',  -- { "A-SMALL": 38.1, …, "D-MAX": 45.7 }
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (shop_id, nom)
);

-- Profil de tailles : grille taille de vêtement → taille d'impression, par modèle
CREATE TABLE IF NOT EXISTS mockup_profils (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  modele TEXT NOT NULL,
  nom TEXT NOT NULL,
  grille JSONB NOT NULL,                 -- { "XS": "B-MEDIUM", "S": "C-LARGE", "M": "D-MAX", … }
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (shop_id, modele, nom)
);

-- RLS : accès membre de la boutique (les routes API passent par service_role)
ALTER TABLE mockup_gabarits ENABLE ROW LEVEL SECURITY;
ALTER TABLE mockups ENABLE ROW LEVEL SECURITY;
ALTER TABLE mockup_reglages ENABLE ROW LEVEL SECURITY;
ALTER TABLE mockup_motifs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mockup_profils ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mockup_gabarits_member" ON mockup_gabarits FOR ALL
  USING (EXISTS (SELECT 1 FROM user_shops WHERE user_shops.shop_id = mockup_gabarits.shop_id AND user_shops.user_id = (SELECT auth.uid())));
CREATE POLICY "mockups_member" ON mockups FOR ALL
  USING (EXISTS (SELECT 1 FROM user_shops WHERE user_shops.shop_id = mockups.shop_id AND user_shops.user_id = (SELECT auth.uid())));
CREATE POLICY "mockup_reglages_member" ON mockup_reglages FOR ALL
  USING (EXISTS (SELECT 1 FROM user_shops WHERE user_shops.shop_id = mockup_reglages.shop_id AND user_shops.user_id = (SELECT auth.uid())));
CREATE POLICY "mockup_motifs_member" ON mockup_motifs FOR ALL
  USING (EXISTS (SELECT 1 FROM user_shops WHERE user_shops.shop_id = mockup_motifs.shop_id AND user_shops.user_id = (SELECT auth.uid())));
CREATE POLICY "mockup_profils_member" ON mockup_profils FOR ALL
  USING (EXISTS (SELECT 1 FROM user_shops WHERE user_shops.shop_id = mockup_profils.shop_id AND user_shops.user_id = (SELECT auth.uid())));

-- Bucket public : les mockups finissent publics sur Shopify ; écriture via routes serveur uniquement
INSERT INTO storage.buckets (id, name, public)
VALUES ('mockups', 'mockups', true)
ON CONFLICT (id) DO NOTHING;
