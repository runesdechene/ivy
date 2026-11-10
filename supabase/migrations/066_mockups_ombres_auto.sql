-- Ombres tirées de la photo du gabarit : intensité par version (0 = sans ombres).
-- Un fichier d'ombres déposé reste prioritaire.
ALTER TABLE mockup_gabarits
  ADD COLUMN IF NOT EXISTS ombres_clair_intensite REAL NOT NULL DEFAULT 3 CHECK (ombres_clair_intensite BETWEEN 0 AND 10),
  ADD COLUMN IF NOT EXISTS ombres_sombre_intensite REAL NOT NULL DEFAULT 3 CHECK (ombres_sombre_intensite BETWEEN 0 AND 10);
