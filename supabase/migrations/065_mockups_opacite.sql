-- Opacité de l'encre sur les mockups (pas sur les fichiers d'impression, toujours pleins).
ALTER TABLE mockup_reglages
  ADD COLUMN IF NOT EXISTS opacite_encre REAL NOT NULL DEFAULT 0.75
  CHECK (opacite_encre > 0 AND opacite_encre <= 1);
