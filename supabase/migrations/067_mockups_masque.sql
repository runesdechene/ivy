-- Masque de l'encre d'un gabarit : blanc = l'encre passe, noir = effacée (cordons d'un sweat…).
ALTER TABLE mockup_gabarits ADD COLUMN IF NOT EXISTS masque_path TEXT;
